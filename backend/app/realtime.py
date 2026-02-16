"""
OpenAI Realtime API session endpoint.
Creates ephemeral tokens for frontend WebRTC connections,
keeping the API key server-side.
"""

import os
import httpx
from fastapi import APIRouter, HTTPException

router = APIRouter(prefix="/api/realtime", tags=["realtime"])

OPENAI_API_KEY = os.environ.get("OPENAI_API_KEY", "")
OPENAI_BASE_URL = os.environ.get("OPENAI_BASE_URL", "https://api.openai.com")
REALTIME_MODEL = "gpt-realtime"


@router.post("/session")
async def create_realtime_session():
    """
    Create an ephemeral session token for the OpenAI Realtime API.
    The frontend uses this short-lived token to establish a WebRTC connection.
    Also returns the realtime_url so the frontend knows which endpoint to connect to.
    """
    if not OPENAI_API_KEY:
        raise HTTPException(
            status_code=500,
            detail="OPENAI_API_KEY not configured on server"
        )

    try:
        async with httpx.AsyncClient() as client:
            response = await client.post(
                f"{OPENAI_BASE_URL}/v1/realtime/sessions",
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
    except httpx.RequestError as e:
        raise HTTPException(
            status_code=502,
            detail=f"Failed to connect to OpenAI API: {str(e)}"
        )

    if response.status_code != 200:
        raise HTTPException(
            status_code=502,
            detail=f"OpenAI API error ({response.status_code}): {response.text}"
        )

    data = response.json()

    return {
        "token": data["client_secret"]["value"],
        "expires_at": data.get("expires_at"),
        "realtime_url": f"{OPENAI_BASE_URL}/v1/realtime",
    }
