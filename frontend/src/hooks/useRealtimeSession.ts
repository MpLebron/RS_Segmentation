import { useCallback, useRef, useState } from 'react'
import type { RealtimeEvent, ToolDefinition, VoiceStatus } from '../types/voice'
import { REALTIME_MODEL, VAD_CONFIG } from '../config/voiceConfig'

const TARGET_SAMPLE_RATE = 24000
const PROCESSOR_BUFFER_SIZE = 4096

type ExtendedWindow = Window & typeof globalThis & {
  webkitAudioContext?: typeof AudioContext
}

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

function getAudioContextConstructor(): typeof AudioContext {
  const audioContextConstructor = window.AudioContext || (window as ExtendedWindow).webkitAudioContext
  if (!audioContextConstructor) {
    throw new Error('当前浏览器不支持 Web Audio API')
  }
  return audioContextConstructor
}

function getRealtimeWebSocketUrl(): string {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${protocol}//${window.location.host}/api/realtime/ws`
}

function floatToPcm16(value: number): number {
  const clamped = Math.max(-1, Math.min(1, value))
  return clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff
}

function downsampleToPcm16(input: ArrayLike<number>, inputSampleRate: number, targetSampleRate: number): Int16Array {
  if (input.length === 0) {
    return new Int16Array(0)
  }

  if (inputSampleRate === targetSampleRate) {
    const pcm16 = new Int16Array(input.length)
    for (let index = 0; index < input.length; index += 1) {
      pcm16[index] = floatToPcm16(input[index])
    }
    return pcm16
  }

  const sampleRateRatio = inputSampleRate / targetSampleRate
  const outputLength = Math.max(1, Math.round(input.length / sampleRateRatio))
  const output = new Int16Array(outputLength)

  let inputOffset = 0
  for (let outputIndex = 0; outputIndex < outputLength; outputIndex += 1) {
    const nextInputOffset = Math.min(
      input.length,
      Math.round((outputIndex + 1) * sampleRateRatio),
    )

    let total = 0
    let count = 0

    for (let index = inputOffset; index < nextInputOffset; index += 1) {
      total += input[index]
      count += 1
    }

    const sample = count > 0 ? total / count : input[Math.min(inputOffset, input.length - 1)]
    output[outputIndex] = floatToPcm16(sample)
    inputOffset = nextInputOffset
  }

  return output
}

function uint8ArrayToBase64(bytes: Uint8Array): string {
  let binary = ''
  const chunkSize = 0x8000

  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    const chunk = bytes.subarray(offset, offset + chunkSize)
    binary += String.fromCharCode(...chunk)
  }

  return window.btoa(binary)
}

function pcm16ToBase64(pcm16: Int16Array): string {
  return uint8ArrayToBase64(new Uint8Array(pcm16.buffer))
}

function base64ToPcm16(base64Audio: string): Int16Array {
  const binary = window.atob(base64Audio)
  const bytes = new Uint8Array(binary.length)

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index)
  }

  return new Int16Array(bytes.buffer)
}

function pcm16ToFloat32(pcm16: Int16Array): number[] {
  const float32 = new Array<number>(pcm16.length)

  for (let index = 0; index < pcm16.length; index += 1) {
    float32[index] = pcm16[index] / 0x8000
  }

  return float32
}

function isAudioDeltaEvent(event: RealtimeEvent): boolean {
  return event.type === 'response.audio.delta' || event.type === 'response.output_audio.delta'
}

function extractAudioDelta(event: RealtimeEvent): string | null {
  const delta = event.delta
  return typeof delta === 'string' ? delta : null
}

function extractRealtimeErrorMessage(event: RealtimeEvent): string | null {
  const error = event.error
  if (!error || typeof error !== 'object') {
    return null
  }

  const message = (error as { message?: unknown }).message
  return typeof message === 'string' ? message : null
}

async function getPreferredMicrophoneStream(): Promise<MediaStream> {
  const devices = await navigator.mediaDevices.enumerateDevices()
  const audioInputs = devices.filter((device) => device.kind === 'audioinput')
  const preferredInput = audioInputs.find((device) => {
    const label = device.label.toLowerCase()
    return label && !label.includes('virtual') && !label.includes('omi')
  })

  if (preferredInput) {
    return navigator.mediaDevices.getUserMedia({
      audio: { deviceId: { exact: preferredInput.deviceId } },
    })
  }

  return navigator.mediaDevices.getUserMedia({ audio: true })
}

export function useRealtimeSession(options: UseRealtimeSessionOptions) {
  const { onEvent, tools, instructions, voice = 'alloy' } = options

  const [state, setState] = useState<RealtimeSessionState>({
    status: 'disconnected',
    error: null,
  })

  const wsRef = useRef<WebSocket | null>(null)
  const micStreamRef = useRef<MediaStream | null>(null)
  const inputAudioContextRef = useRef<AudioContext | null>(null)
  const inputSourceRef = useRef<MediaStreamAudioSourceNode | null>(null)
  const inputProcessorRef = useRef<ScriptProcessorNode | null>(null)
  const inputSinkRef = useRef<GainNode | null>(null)
  const outputAudioContextRef = useRef<AudioContext | null>(null)
  const activeSourcesRef = useRef<AudioBufferSourceNode[]>([])
  const nextPlaybackTimeRef = useRef(0)
  const intentionalDisconnectRef = useRef(false)

  const stopAudioPlayback = useCallback(() => {
    nextPlaybackTimeRef.current = 0
    const activeSources = activeSourcesRef.current.splice(0)
    activeSources.forEach((source) => {
      source.onended = null
      try {
        source.stop()
      } catch {
        // Ignore sources that already finished.
      }
      source.disconnect()
    })
  }, [])

  const releaseAudioResources = useCallback(() => {
    stopAudioPlayback()

    if (inputProcessorRef.current) {
      inputProcessorRef.current.onaudioprocess = null
      inputProcessorRef.current.disconnect()
      inputProcessorRef.current = null
    }

    if (inputSourceRef.current) {
      inputSourceRef.current.disconnect()
      inputSourceRef.current = null
    }

    if (inputSinkRef.current) {
      inputSinkRef.current.disconnect()
      inputSinkRef.current = null
    }

    if (micStreamRef.current) {
      micStreamRef.current.getTracks().forEach((track) => track.stop())
      micStreamRef.current = null
    }

    if (inputAudioContextRef.current) {
      const audioContext = inputAudioContextRef.current
      inputAudioContextRef.current = null
      void audioContext.close().catch(() => undefined)
    }

    if (outputAudioContextRef.current) {
      const audioContext = outputAudioContextRef.current
      outputAudioContextRef.current = null
      void audioContext.close().catch(() => undefined)
    }
  }, [stopAudioPlayback])

  const sendEvent = useCallback((event: object) => {
    const socket = wsRef.current
    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify(event))
    }
  }, [])

  const ensureOutputAudioContext = useCallback(async () => {
    if (!outputAudioContextRef.current) {
      const AudioContextConstructor = getAudioContextConstructor()
      outputAudioContextRef.current = new AudioContextConstructor({
        sampleRate: TARGET_SAMPLE_RATE,
      })
    }

    if (outputAudioContextRef.current.state === 'suspended') {
      await outputAudioContextRef.current.resume()
    }

    return outputAudioContextRef.current
  }, [])

  const queueAudioPlayback = useCallback(async (base64Audio: string) => {
    if (!base64Audio) {
      return
    }

    const outputAudioContext = await ensureOutputAudioContext()
    const pcm16 = base64ToPcm16(base64Audio)

    if (pcm16.length === 0) {
      return
    }

    const audioBuffer = outputAudioContext.createBuffer(1, pcm16.length, TARGET_SAMPLE_RATE)
    audioBuffer.getChannelData(0).set(pcm16ToFloat32(pcm16))

    const source = outputAudioContext.createBufferSource()
    source.buffer = audioBuffer
    source.connect(outputAudioContext.destination)

    const startTime = Math.max(outputAudioContext.currentTime + 0.02, nextPlaybackTimeRef.current)
    nextPlaybackTimeRef.current = startTime + audioBuffer.duration

    activeSourcesRef.current.push(source)
    source.onended = () => {
      activeSourcesRef.current = activeSourcesRef.current.filter((item) => item !== source)
      source.disconnect()
    }
    source.start(startTime)
  }, [ensureOutputAudioContext])

  const startMicrophoneStreaming = useCallback(async (socket: WebSocket) => {
    const micStream = await getPreferredMicrophoneStream()
    micStreamRef.current = micStream

    const AudioContextConstructor = getAudioContextConstructor()
    const inputAudioContext = new AudioContextConstructor()
    inputAudioContextRef.current = inputAudioContext

    if (inputAudioContext.state === 'suspended') {
      await inputAudioContext.resume()
    }

    const source = inputAudioContext.createMediaStreamSource(micStream)
    const processor = inputAudioContext.createScriptProcessor(PROCESSOR_BUFFER_SIZE, 1, 1)
    const mutedSink = inputAudioContext.createGain()
    mutedSink.gain.value = 0

    processor.onaudioprocess = (audioProcessingEvent) => {
      if (socket.readyState !== WebSocket.OPEN) {
        return
      }

      const channelData = audioProcessingEvent.inputBuffer.getChannelData(0)
      const pcm16 = downsampleToPcm16(channelData, inputAudioContext.sampleRate, TARGET_SAMPLE_RATE)
      if (pcm16.length === 0) {
        return
      }

      socket.send(JSON.stringify({
        type: 'input_audio_buffer.append',
        audio: pcm16ToBase64(pcm16),
      }))
    }

    source.connect(processor)
    processor.connect(mutedSink)
    mutedSink.connect(inputAudioContext.destination)

    inputSourceRef.current = source
    inputProcessorRef.current = processor
    inputSinkRef.current = mutedSink
  }, [])

  const disconnect = useCallback(() => {
    intentionalDisconnectRef.current = true

    const socket = wsRef.current
    wsRef.current = null
    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.close()
    }

    releaseAudioResources()
    setState({ status: 'disconnected', error: null })
  }, [releaseAudioResources])

  const connect = useCallback(async () => {
    setState({ status: 'connecting', error: null })
    intentionalDisconnectRef.current = false

    try {
      if (!window.isSecureContext) {
        throw new Error('语音助手需要 HTTPS 或 localhost 才能使用麦克风')
      }

      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error('当前浏览器不支持麦克风采集')
      }

      await ensureOutputAudioContext()

      const socket = await new Promise<WebSocket>((resolve, reject) => {
        const realtimeSocket = new WebSocket(getRealtimeWebSocketUrl())

        realtimeSocket.onopen = () => resolve(realtimeSocket)
        realtimeSocket.onerror = () => reject(new Error('无法连接语音中转服务'))
      })

      wsRef.current = socket

      socket.onmessage = (messageEvent) => {
        try {
          const parsed = JSON.parse(messageEvent.data) as RealtimeEvent

          if (isAudioDeltaEvent(parsed)) {
            const delta = extractAudioDelta(parsed)
            if (delta) {
              void queueAudioPlayback(delta)
            }
          }

          if (parsed.type === 'input_audio_buffer.speech_started') {
            stopAudioPlayback()
          }

          if (parsed.type === 'error') {
            const errorMessage = extractRealtimeErrorMessage(parsed)
            if (errorMessage) {
              setState({ status: 'error', error: errorMessage })
            }
          }

          onEvent(parsed)
        } catch (error) {
          console.error('Failed to parse realtime websocket message:', error)
        }
      }

      socket.onclose = () => {
        wsRef.current = null
        releaseAudioResources()

        if (intentionalDisconnectRef.current) {
          setState({ status: 'disconnected', error: null })
          return
        }

        setState((previousState) => ({
          status: 'error',
          error: previousState.error || '语音连接已断开',
        }))
      }

      socket.onerror = () => {
        if (!intentionalDisconnectRef.current) {
          setState({ status: 'error', error: '语音连接发生异常' })
        }
      }

      socket.send(JSON.stringify({
        type: 'session.update',
        session: {
          type: 'realtime',
          model: REALTIME_MODEL,
          output_modalities: ['audio'],
          instructions,
          audio: {
            input: {
              format: {
                type: 'audio/pcm',
                rate: TARGET_SAMPLE_RATE,
              },
              transcription: { model: 'whisper-1' },
              turn_detection: {
                ...VAD_CONFIG,
                create_response: true,
                interrupt_response: true,
              },
            },
            output: {
              format: {
                type: 'audio/pcm',
                rate: TARGET_SAMPLE_RATE,
              },
              voice,
            },
          },
          tool_choice: 'auto',
          tools: tools.map((tool) => ({
            type: tool.type,
            name: tool.name,
            description: tool.description,
            parameters: tool.parameters,
          })),
        },
      }))

      await startMicrophoneStreaming(socket)
      setState({ status: 'connected', error: null })
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : '语音服务连接失败'
      console.error('Realtime session error:', error)

      const socket = wsRef.current
      wsRef.current = null
      if (socket && socket.readyState === WebSocket.OPEN) {
        socket.close()
      }

      releaseAudioResources()
      setState({ status: 'error', error: errorMessage })
    }
  }, [
    ensureOutputAudioContext,
    instructions,
    onEvent,
    queueAudioPlayback,
    releaseAudioResources,
    startMicrophoneStreaming,
    stopAudioPlayback,
    tools,
    voice,
  ])

  return {
    state,
    connect,
    disconnect,
    sendEvent,
  }
}
