import { useState, useRef, useCallback } from 'react'
import type { RealtimeEvent, ToolDefinition, VoiceStatus } from '../types/voice'
import { REALTIME_MODEL, VAD_CONFIG } from '../config/voiceConfig'

export interface RealtimeSessionState {
  status: VoiceStatus
  error: string | null
}

interface UseRealtimeSessionOptions {
  onEvent: (event: RealtimeEvent) => void
  tools: ToolDefinition[]
  instructions: string
  voice?: string
}

export function useRealtimeSession(options: UseRealtimeSessionOptions) {
  const { onEvent, tools, instructions, voice = 'alloy' } = options

  const [state, setState] = useState<RealtimeSessionState>({
    status: 'disconnected',
    error: null,
  })

  const pcRef = useRef<RTCPeerConnection | null>(null)
  const dcRef = useRef<RTCDataChannel | null>(null)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const micStreamRef = useRef<MediaStream | null>(null)

  const sendEvent = useCallback((event: object) => {
    const dc = dcRef.current
    if (dc && dc.readyState === 'open') {
      dc.send(JSON.stringify(event))
    }
  }, [])

  const disconnect = useCallback(() => {
    // Close data channel
    if (dcRef.current) {
      dcRef.current.close()
      dcRef.current = null
    }

    // Stop microphone tracks
    if (micStreamRef.current) {
      micStreamRef.current.getTracks().forEach(track => track.stop())
      micStreamRef.current = null
    }

    // Close peer connection
    if (pcRef.current) {
      pcRef.current.close()
      pcRef.current = null
    }

    // Stop audio playback
    if (audioRef.current) {
      audioRef.current.srcObject = null
    }

    setState({ status: 'disconnected', error: null })
  }, [])

  const connect = useCallback(async () => {
    setState({ status: 'connecting', error: null })

    try {
      // Step 1: Get ephemeral token from backend
      const tokenResponse = await fetch('/api/realtime/session', {
        method: 'POST',
      })

      if (!tokenResponse.ok) {
        const errData = await tokenResponse.json().catch(() => ({ detail: 'Token request failed' }))
        throw new Error(errData.detail || `Token error: ${tokenResponse.status}`)
      }

      const { token, realtime_url } = await tokenResponse.json()

      // Step 2: Request microphone access - prefer physical mic over virtual devices
      let micStream: MediaStream
      try {
        // List all audio input devices
        const devices = await navigator.mediaDevices.enumerateDevices()
        const audioInputs = devices.filter(d => d.kind === 'audioinput')
        console.log('[WebRTC] Available microphones:', audioInputs.map(d => `${d.label} (${d.deviceId.slice(0, 8)})`))

        // Try to find a real mic (skip virtual/Omi devices)
        const realMic = audioInputs.find(d =>
          d.label && !d.label.toLowerCase().includes('virtual') && !d.label.toLowerCase().includes('omi')
        )

        if (realMic) {
          console.log('[WebRTC] Using mic:', realMic.label)
          micStream = await navigator.mediaDevices.getUserMedia({
            audio: { deviceId: { exact: realMic.deviceId } }
          })
        } else {
          console.log('[WebRTC] No preferred mic found, using default')
          micStream = await navigator.mediaDevices.getUserMedia({ audio: true })
        }
      } catch {
        throw new Error('请允许浏览器使用麦克风')
      }
      micStreamRef.current = micStream

      // Step 3: Create RTCPeerConnection
      const pc = new RTCPeerConnection()
      pcRef.current = pc

      // Step 4: Set up audio playback for AI responses
      const audioEl = new Audio()
      audioEl.autoplay = true
      audioRef.current = audioEl

      pc.ontrack = (event) => {
        console.log('[WebRTC] Remote track received:', event.track.kind)
        audioEl.srcObject = event.streams[0]
      }

      // Monitor connection state
      pc.onconnectionstatechange = () => {
        console.log('[WebRTC] Connection state:', pc.connectionState)
      }
      pc.oniceconnectionstatechange = () => {
        console.log('[WebRTC] ICE connection state:', pc.iceConnectionState)
      }
      pc.onicegatheringstatechange = () => {
        console.log('[WebRTC] ICE gathering state:', pc.iceGatheringState)
      }

      // Step 5: Add microphone track
      const micTrack = micStream.getAudioTracks()[0]
      console.log('[WebRTC] Mic track:', micTrack.label, 'enabled:', micTrack.enabled, 'readyState:', micTrack.readyState)
      pc.addTrack(micTrack, micStream)

      // Debug: Monitor mic audio levels
      const audioCtx = new AudioContext()
      const source = audioCtx.createMediaStreamSource(micStream)
      const analyser = audioCtx.createAnalyser()
      analyser.fftSize = 256
      source.connect(analyser)
      const dataArray = new Uint8Array(analyser.frequencyBinCount)
      let levelLogCount = 0
      const checkLevel = () => {
        if (!micStreamRef.current) return
        analyser.getByteFrequencyData(dataArray)
        const avg = dataArray.reduce((a, b) => a + b, 0) / dataArray.length
        if (avg > 0 || levelLogCount % 60 === 0) {
          console.log('[Mic Level]', avg.toFixed(1))
        }
        levelLogCount++
        if (levelLogCount < 600) requestAnimationFrame(checkLevel) // ~10 seconds
      }
      checkLevel()

      // Step 6: Create data channel for JSON events
      const dc = pc.createDataChannel('oai-events')
      dcRef.current = dc

      dc.onopen = () => {
        // Send session configuration once data channel is open
        const sessionUpdate = {
          type: 'session.update',
          session: {
            modalities: ['text', 'audio'],
            instructions,
            voice,
            input_audio_transcription: { model: 'whisper-1' },
            turn_detection: VAD_CONFIG,
            tools: tools.map(t => ({
              type: t.type,
              name: t.name,
              description: t.description,
              parameters: t.parameters,
            })),
          },
        }
        dc.send(JSON.stringify(sessionUpdate))
        setState({ status: 'connected', error: null })
      }

      dc.onmessage = (event) => {
        try {
          const parsed = JSON.parse(event.data) as RealtimeEvent
          console.log('[Realtime Event]', parsed.type, parsed)
          onEvent(parsed)
        } catch (err) {
          console.error('Failed to parse data channel message:', err)
        }
      }

      dc.onclose = () => {
        console.log('Data channel closed')
        // Only update state if we haven't already disconnected intentionally
        if (pcRef.current) {
          setState({ status: 'error', error: '连接已断开' })
        }
      }

      // Step 7: Create and send SDP offer (implicit style, as per OpenAI docs)
      await pc.setLocalDescription()

      // Use realtime_url from backend (proxy-aware) or fall back to OpenAI
      const baseRealtimeUrl = realtime_url || 'https://api.openai.com/v1/realtime'
      console.log('[WebRTC] Sending SDP offer to:', `${baseRealtimeUrl}?model=${REALTIME_MODEL}`)
      const sdpResponse = await fetch(
        `${baseRealtimeUrl}?model=${REALTIME_MODEL}`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/sdp',
          },
          body: pc.localDescription?.sdp,
        }
      )

      if (!sdpResponse.ok) {
        throw new Error(`WebRTC negotiation failed: ${sdpResponse.status}`)
      }

      const answerSdp = await sdpResponse.text()
      await pc.setRemoteDescription({ type: 'answer', sdp: answerSdp })

      // Connection established - state will update to 'connected' when data channel opens

    } catch (err) {
      const errorMessage = (err as Error).message || '语音服务连接失败'
      console.error('Realtime session error:', err)

      // Clean up on failure
      if (micStreamRef.current) {
        micStreamRef.current.getTracks().forEach(track => track.stop())
        micStreamRef.current = null
      }
      if (pcRef.current) {
        pcRef.current.close()
        pcRef.current = null
      }
      dcRef.current = null

      setState({ status: 'error', error: errorMessage })
    }
  }, [instructions, voice, tools, onEvent])

  return {
    state,
    connect,
    disconnect,
    sendEvent,
  }
}
