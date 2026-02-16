// Type definitions for OpenAI Realtime API voice control

export interface ToolDefinition {
  type: 'function'
  name: string
  description: string
  parameters: {
    type: 'object'
    properties: Record<string, {
      type: string
      description: string
      enum?: string[]
    }>
    required: string[]
  }
}

export interface RealtimeEvent {
  type: string
  event_id?: string
  [key: string]: unknown
}

export interface ResponseDoneEvent extends RealtimeEvent {
  type: 'response.done'
  response: {
    id: string
    output: ResponseOutputItem[]
    status: string
  }
}

export interface ResponseOutputItem {
  type: 'function_call' | 'message'
  id: string
  name?: string
  call_id?: string
  arguments?: string
  content?: Array<{
    type: string
    text?: string
    transcript?: string
  }>
}

export interface TranscriptEntry {
  role: 'user' | 'assistant'
  text: string
  timestamp: number
}

export type VoiceStatus = 'disconnected' | 'connecting' | 'connected' | 'error'
