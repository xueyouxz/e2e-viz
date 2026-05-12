// Shared message types between SceneDataManager (host) and messageParse.worker.ts.
// DOM-free — safe to import in both contexts.
import type { StreamMeta, RawDecodedFrame } from '../../types'

export interface WorkerInitMessage {
  type: 'init'
  streamsMeta: Record<string, StreamMeta>
}

export interface WorkerParseRequest {
  type: 'parse'
  id: number
  buffer: ArrayBuffer
}

export type WorkerInMessage = WorkerInitMessage | WorkerParseRequest

export type WorkerParseResponse =
  | { id: number; ok: true; frame: RawDecodedFrame }
  | { id: number; ok: false; error: string }

export function isWorkerParseResponse(data: unknown): data is WorkerParseResponse {
  if (!data || typeof data !== 'object') return false
  const d = data as Record<string, unknown>
  return typeof d.id === 'number' && typeof d.ok === 'boolean'
}
