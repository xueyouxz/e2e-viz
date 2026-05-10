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
