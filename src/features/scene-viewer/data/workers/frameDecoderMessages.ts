// DOM-free IPC contract shared by the host adapter and decoder Worker.
import type { RawDecodedFrame, StreamMeta } from '../../types'

export interface FrameDecoderInitMessage {
  type: 'init'
  streamsMeta: Record<string, StreamMeta>
}

export interface FrameDecodeRequest {
  type: 'decode'
  id: number
  buffer: ArrayBuffer
}

export type FrameDecoderMessage = FrameDecoderInitMessage | FrameDecodeRequest

export type FrameDecodeResponse =
  | { id: number; ok: true; decodedFrame: RawDecodedFrame }
  | { id: number; ok: false; error: string }

export function isFrameDecodeResponse(data: unknown): data is FrameDecodeResponse {
  if (!data || typeof data !== 'object') return false
  const candidate = data as Record<string, unknown>
  if (typeof candidate.id !== 'number' || typeof candidate.ok !== 'boolean') return false
  return candidate.ok ? 'decodedFrame' in candidate : typeof candidate.error === 'string'
}
