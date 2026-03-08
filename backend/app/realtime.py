"""
OpenAI Realtime API helpers.

The browser connects only to this server. The backend then establishes the
upstream Realtime websocket to OpenAI, so end users do not need direct network
access to OpenAI from their own machines.
"""

import asyncio
import contextlib
import logging
import os
from urllib.parse import urlparse, urlunparse

import aiohttp
import httpx
from fastapi import APIRouter, HTTPException, WebSocket, WebSocketDisconnect, status

router = APIRouter(prefix="/api/realtime", tags=["realtime"])

OPENAI_API_KEY = os.environ.get("OPENAI_API_KEY", "")
OPENAI_BASE_URL = os.environ.get("OPENAI_BASE_URL", "https://api.openai.com")
REALTIME_MODEL = os.environ.get("REALTIME_MODEL", "gpt-realtime")

logger = logging.getLogger(__name__)


def _build_openai_realtime_http_url() -> str:
    return f"{OPENAI_BASE_URL.rstrip('/')}/v1/realtime/sessions"


def _build_openai_realtime_ws_url() -> str:
    parsed = urlparse(OPENAI_BASE_URL.rstrip("/"))
    scheme = "wss" if parsed.scheme == "https" else "ws"
    path = f"{parsed.path.rstrip('/')}/v1/realtime"
    return urlunparse(parsed._replace(scheme=scheme, path=path, query="", fragment=""))


def _get_realtime_proxy_url(target_url: str) -> str | None:
    scheme = urlparse(target_url).scheme
    if scheme in {"https", "wss"}:
        return (
            os.environ.get("HTTPS_PROXY")
            or os.environ.get("https_proxy")
            or os.environ.get("HTTP_PROXY")
            or os.environ.get("http_proxy")
        )

    return os.environ.get("HTTP_PROXY") or os.environ.get("http_proxy")


async def _send_proxy_error(websocket: WebSocket, message: str, error_type: str) -> None:
    await websocket.send_json(
        {
            "type": "error",
            "error": {
                "type": error_type,
                "message": message,
            },
        }
    )


@router.post("/session")
async def create_realtime_session():
    """
    Create an ephemeral session token for the OpenAI Realtime API.

    This endpoint is retained for compatibility, but the preferred transport is
    now the server-side websocket proxy at `/api/realtime/ws`.
    """
    if not OPENAI_API_KEY:
        raise HTTPException(
            status_code=500,
            detail="OPENAI_API_KEY not configured on server"
        )

    try:
        async with httpx.AsyncClient(trust_env=True) as client:
            response = await client.post(
                _build_openai_realtime_http_url(),
                headers={
                    "Authorization": f"Bearer {OPENAI_API_KEY}",
                    "Content-Type": "application/json",
                },
                json={
                    "model": REALTIME_MODEL,
                    "voice": "alloy",
                },
                timeout=10.0,
            )
    except httpx.RequestError as exc:
        raise HTTPException(
            status_code=502,
            detail=f"Failed to connect to OpenAI API: {str(exc)}"
        ) from exc

    if response.status_code != 200:
        raise HTTPException(
            status_code=502,
            detail=f"OpenAI API error ({response.status_code}): {response.text}"
        )

    data = response.json()

    return {
        "token": data["client_secret"]["value"],
        "expires_at": data.get("expires_at"),
        "realtime_url": f"{OPENAI_BASE_URL.rstrip('/')}/v1/realtime",
        "transport": "server_websocket_available",
        "websocket_path": "/api/realtime/ws",
    }


async def _relay_browser_to_openai(client_ws: WebSocket, upstream_ws: aiohttp.ClientWebSocketResponse) -> None:
    while True:
        message = await client_ws.receive()
        message_type = message["type"]

        if message_type == "websocket.disconnect":
            raise WebSocketDisconnect()

        if message_type != "websocket.receive":
            continue

        text = message.get("text")
        if text is not None:
            await upstream_ws.send_str(text)
            continue

        payload = message.get("bytes")
        if payload is not None:
            await upstream_ws.send_bytes(payload)


async def _relay_openai_to_browser(client_ws: WebSocket, upstream_ws: aiohttp.ClientWebSocketResponse) -> None:
    async for message in upstream_ws:
        if message.type == aiohttp.WSMsgType.TEXT:
            await client_ws.send_text(message.data)
            continue

        if message.type == aiohttp.WSMsgType.BINARY:
            await client_ws.send_bytes(message.data)
            continue

        if message.type == aiohttp.WSMsgType.ERROR:
            raise upstream_ws.exception() or RuntimeError("OpenAI Realtime websocket error")

        if message.type in (aiohttp.WSMsgType.CLOSE, aiohttp.WSMsgType.CLOSED):
            break


@router.websocket("/ws")
async def realtime_ws_proxy(websocket: WebSocket):
    """
    Relay Realtime websocket events between browser and OpenAI.

    The browser only connects to this endpoint. The server handles the upstream
    OpenAI connection, including proxy/VPN requirements.
    """
    if not OPENAI_API_KEY:
        await websocket.accept()
        await _send_proxy_error(
            websocket,
            "OPENAI_API_KEY not configured on server",
            "config_error",
        )
        await websocket.close(code=status.WS_1011_INTERNAL_ERROR)
        return

    session = aiohttp.ClientSession(
        trust_env=True,
        timeout=aiohttp.ClientTimeout(total=None, connect=15, sock_connect=15, sock_read=None),
    )
    upstream_ws: aiohttp.ClientWebSocketResponse | None = None

    openai_ws_url = f"{_build_openai_realtime_ws_url()}?model={REALTIME_MODEL}"

    try:
        upstream_ws = await session.ws_connect(
            openai_ws_url,
            headers={
                "Authorization": f"Bearer {OPENAI_API_KEY}",
            },
            heartbeat=30,
            autoping=True,
            autoclose=True,
            proxy=_get_realtime_proxy_url(openai_ws_url),
        )
    except Exception as exc:
        logger.exception("Failed to connect to OpenAI Realtime websocket")
        await websocket.accept()
        await _send_proxy_error(
            websocket,
            f"Failed to connect to OpenAI Realtime websocket: {str(exc)}",
            "upstream_connect_error",
        )
        await websocket.close(code=status.WS_1011_INTERNAL_ERROR)
        await session.close()
        return

    await websocket.accept()

    browser_to_openai = asyncio.create_task(_relay_browser_to_openai(websocket, upstream_ws))
    openai_to_browser = asyncio.create_task(_relay_openai_to_browser(websocket, upstream_ws))

    try:
        done, pending = await asyncio.wait(
            {browser_to_openai, openai_to_browser},
            return_when=asyncio.FIRST_COMPLETED,
        )

        for task in done:
            with contextlib.suppress(WebSocketDisconnect, asyncio.CancelledError):
                exc = task.exception()
                if exc:
                    raise exc
    except WebSocketDisconnect:
        logger.info("Realtime websocket disconnected by browser")
    except Exception as exc:
        logger.exception("Realtime websocket proxy error")
        if websocket.client_state.name == "CONNECTED":
            with contextlib.suppress(Exception):
                await _send_proxy_error(
                    websocket,
                    f"Realtime proxy error: {str(exc)}",
                    "proxy_runtime_error",
                )
    finally:
        for task in (browser_to_openai, openai_to_browser):
            task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await task

        if upstream_ws is not None:
            with contextlib.suppress(Exception):
                await upstream_ws.close()

        with contextlib.suppress(Exception):
            await session.close()

        with contextlib.suppress(Exception):
            await websocket.close()
