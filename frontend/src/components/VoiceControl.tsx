import { useState, useCallback, useRef, useEffect } from 'react'
import { useRealtimeSession } from '../hooks/useRealtimeSession'
import { useVoiceTools } from '../hooks/useVoiceTools'
import { SYSTEM_INSTRUCTIONS, REALTIME_VOICE } from '../config/voiceConfig'
import type { DetectedObject } from '../types'
import type { RealtimeEvent, ResponseDoneEvent, TranscriptEntry } from '../types/voice'
import './VoiceControl.css'

interface VoiceControlProps {
  mapRef: React.RefObject<any>
  onObjectsDetected: (objects: DetectedObject[]) => void
  detectedObjects: DetectedObject[]
  onTextSegmentationStart: () => void
  onTextSegmentationComplete: () => void
  onExportShapefile: () => void
  onTextPromptChange: (prompt: string) => void
}

function VoiceControl({
  mapRef,
  onObjectsDetected,
  detectedObjects,
  onTextSegmentationStart,
  onTextSegmentationComplete,
  onExportShapefile,
  onTextPromptChange,
}: VoiceControlProps) {
  const [isActive, setIsActive] = useState(false)
  const [transcripts, setTranscripts] = useState<TranscriptEntry[]>([])
  const [showTranscript, setShowTranscript] = useState(false)
  const transcriptEndRef = useRef<HTMLDivElement>(null)

  // Auto-scroll transcript panel
  useEffect(() => {
    transcriptEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [transcripts])

  // Set up voice tools
  const { toolDefinitions, handleToolCall } = useVoiceTools({
    mapRef,
    onObjectsDetected,
    detectedObjects,
    onTextSegmentationStart,
    onTextSegmentationComplete,
    onExportShapefile,
    onTextPromptChange,
  })

  // Ref to always access latest sendEvent without stale closures
  const sendEventRef = useRef<(event: object) => void>(() => {})

  // Handle incoming Realtime API events
  const handleEvent = useCallback(async (event: RealtimeEvent) => {
    console.log('[VoiceControl handleEvent]', event.type)
    switch (event.type) {
      // User speech transcribed
      case 'conversation.item.input_audio_transcription.completed': {
        const transcript = (event as any).transcript as string
        if (transcript?.trim()) {
          setTranscripts(prev => [...prev, {
            role: 'user',
            text: transcript.trim(),
            timestamp: Date.now(),
          }])
        }
        break
      }

      // AI response text completed
      case 'response.audio_transcript.done': {
        const transcript = (event as any).transcript as string
        if (transcript?.trim()) {
          setTranscripts(prev => [...prev, {
            role: 'assistant',
            text: transcript.trim(),
            timestamp: Date.now(),
          }])
        }
        break
      }

      // Response completed - check for function calls
      case 'response.done': {
        const responseDone = event as ResponseDoneEvent
        const outputs = responseDone.response?.output || []
        console.log('[VoiceControl] response.done FULL:', JSON.stringify(responseDone.response, null, 2))

        for (const item of outputs) {
          if (item.type === 'function_call' && item.name && item.call_id && item.arguments) {
            try {
              const args = JSON.parse(item.arguments)
              const result = await handleToolCall(item.name, args)

              // Send function result back to AI
              sendEventRef.current({
                type: 'conversation.item.create',
                item: {
                  type: 'function_call_output',
                  call_id: item.call_id,
                  output: result,
                },
              })

              // Trigger AI to respond with the result
              sendEventRef.current({ type: 'response.create' })
            } catch (err) {
              console.error('Tool call execution error:', err)

              // Send error result back
              sendEventRef.current({
                type: 'conversation.item.create',
                item: {
                  type: 'function_call_output',
                  call_id: item.call_id,
                  output: `执行失败: ${(err as Error).message}`,
                },
              })
              sendEventRef.current({ type: 'response.create' })
            }
          }
        }
        break
      }

      case 'conversation.item.input_audio_transcription.failed': {
        console.error('[Transcription Failed]', JSON.stringify((event as any).error, null, 2))
        break
      }

      case 'error': {
        console.error('[Realtime API Error]', JSON.stringify(event, null, 2))
        break
      }
    }
  }, [handleToolCall])

  // Set up realtime session
  const { state, connect, disconnect, sendEvent } = useRealtimeSession({
    onEvent: handleEvent,
    tools: toolDefinitions,
    instructions: SYSTEM_INSTRUCTIONS,
    voice: REALTIME_VOICE,
  })

  // Keep sendEventRef current
  useEffect(() => {
    sendEventRef.current = sendEvent
  }, [sendEvent])

  // Toggle voice connection
  const handleToggle = async () => {
    if (isActive) {
      disconnect()
      setIsActive(false)
      setShowTranscript(false)
    } else {
      setTranscripts([])
      await connect()
      setIsActive(true)
      setShowTranscript(true)
    }
  }

  // Determine button style based on status
  const getButtonClass = () => {
    if (state.status === 'error') return 'voice-btn error'
    if (state.status === 'connecting') return 'voice-btn connecting'
    if (state.status === 'connected') return 'voice-btn active'
    return 'voice-btn'
  }

  const getStatusText = () => {
    switch (state.status) {
      case 'connecting': return '正在连接...'
      case 'connected': return '语音已连接 - 请说话'
      case 'error': return state.error || '连接错误'
      default: return '点击开启语音助手'
    }
  }

  const getMicIcon = () => {
    if (state.status === 'connecting') {
      return (
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
        </svg>
      )
    }
    if (state.status === 'error') {
      return (
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="12" cy="12" r="10" />
          <line x1="12" y1="8" x2="12" y2="12" />
          <line x1="12" y1="16" x2="12.01" y2="16" />
        </svg>
      )
    }
    // Microphone icon
    return (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <rect x="9" y="2" width="6" height="11" rx="3" />
        <path d="M5 10a7 7 0 0 0 14 0" />
        <line x1="12" y1="19" x2="12" y2="22" />
        <line x1="8" y1="22" x2="16" y2="22" />
      </svg>
    )
  }

  return (
    <div className="voice-control">
      {/* Transcript panel */}
      {showTranscript && transcripts.length > 0 && (
        <div className="voice-transcript">
          {transcripts.slice(-8).map((entry, i) => (
            <div key={`${entry.timestamp}-${i}`} className={`transcript-line ${entry.role}`}>
              <span className="transcript-role">
                {entry.role === 'user' ? '你' : 'AI'}
              </span>
              <span className="transcript-text">{entry.text}</span>
            </div>
          ))}
          <div ref={transcriptEndRef} />
        </div>
      )}

      {/* Status text */}
      <div className="voice-status">{getStatusText()}</div>

      {/* Microphone button */}
      <button
        className={getButtonClass()}
        onClick={handleToggle}
        title={getStatusText()}
      >
        {state.status === 'connected' && <span className="voice-pulse" />}
        {getMicIcon()}
      </button>
    </div>
  )
}

export default VoiceControl
