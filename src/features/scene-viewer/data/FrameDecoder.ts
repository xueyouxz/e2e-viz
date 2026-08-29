// DOM-free frame decoding plus the Worker/main-thread adapters.
import { parseGlb, readAccessor, readImageBytes } from './GlbReader'
import { isFrameDecodeResponse } from './workers/frameDecoderMessages'
import type { GlbJson } from './GlbReader'
import type { EgoPose, RawDecodedFrame, RawStreamPayload, StreamMeta } from '../types'

interface NuvizStateUpdate {
  nuviz: {
    type: string
    data: {
      update_type: 'COMPLETE_STATE' | 'INCREMENTAL'
      updates: Array<{
        timestamp: number
        poses?: Record<string, EgoPose>
        primitives?: Record<string, unknown>
      }>
    }
  }
}

interface PendingDecode {
  resolve: (frame: RawDecodedFrame) => void
  reject: (error: Error) => void
}

type WorkerFactory = () => Worker

function decodePoint(json: GlbJson, bin: DataView, payload: Record<string, unknown>) {
  const points = (readAccessor(json, bin, payload.points as string) as Float32Array).slice()
  const intensity =
    typeof payload.INTENSITY === 'string'
      ? (readAccessor(json, bin, payload.INTENSITY) as Float32Array).slice()
      : null
  return { _raw: 'point' as const, points, intensity }
}

function decodePath(
  json: GlbJson,
  bin: DataView,
  payload: Record<string, unknown>,
  streamName: string,
  streamsMeta: Record<string, StreamMeta>
): RawStreamPayload {
  const vertices = (readAccessor(json, bin, payload.vertices as string) as Float32Array).slice()
  const offsets = (readAccessor(json, bin, payload.offsets as string) as Uint32Array).slice()
  const count = (payload.count as number) ?? offsets.length - 1
  const rawType = streamsMeta[streamName]?.type === 'polygon' ? 'polygon' : 'polyline'
  return { _raw: rawType, vertices, offsets, count }
}

function decodeCuboid(
  json: GlbJson,
  bin: DataView,
  payload: Record<string, unknown>
): RawStreamPayload {
  const centers = (readAccessor(json, bin, payload.CENTER as string) as Float32Array).slice()
  const sizes = (readAccessor(json, bin, payload.SIZE as string) as Float32Array).slice()
  const rotations = (readAccessor(json, bin, payload.ROTATION as string) as Float32Array).slice()
  const classIds = (readAccessor(json, bin, payload.CLASS_ID as string) as Uint32Array).slice()
  const trackIds =
    typeof payload.TRACK_ID === 'string'
      ? (readAccessor(json, bin, payload.TRACK_ID) as Uint32Array).slice()
      : null
  const scores =
    typeof payload.SCORE === 'string'
      ? (readAccessor(json, bin, payload.SCORE) as Float32Array).slice()
      : null
  return {
    _raw: 'cuboid',
    centers,
    sizes,
    rotations,
    classIds,
    trackIds,
    scores,
    count: payload.count as number
  }
}

function decodeImage(
  json: GlbJson,
  bin: DataView,
  payload: Record<string, unknown>
): RawStreamPayload {
  const { bytes, mimeType } = readImageBytes(json, bin, payload.image as string)
  const bounds =
    payload.bounds && typeof payload.bounds === 'object' && 'min_x' in payload.bounds
      ? (payload.bounds as { min_x: number; min_y: number; max_x: number; max_y: number })
      : undefined
  return {
    _raw: 'image',
    bytes,
    mimeType,
    width: (payload.width as number) ?? 0,
    height: (payload.height as number) ?? 0,
    bounds
  }
}

export function decodeFrame(
  buffer: ArrayBuffer,
  streamsMeta: Record<string, StreamMeta>
): RawDecodedFrame {
  const { json, bin } = parseGlb(buffer)
  const root = json as unknown as NuvizStateUpdate
  const { update_type, updates } = root.nuviz.data
  const update = updates[0]
  const patches: Record<string, RawStreamPayload> = {}

  for (const [streamName, rawPayload] of Object.entries(update.primitives ?? {})) {
    if (!rawPayload || typeof rawPayload !== 'object') continue
    const payload = rawPayload as Record<string, unknown>

    try {
      if (typeof payload.points === 'string') {
        patches[streamName] = decodePoint(json, bin, payload)
      } else if (typeof payload.vertices === 'string') {
        patches[streamName] = decodePath(json, bin, payload, streamName, streamsMeta)
      } else if (typeof payload.CENTER === 'string') {
        patches[streamName] = decodeCuboid(json, bin, payload)
      } else if (typeof payload.image === 'string') {
        patches[streamName] = decodeImage(json, bin, payload)
      }
    } catch {
      // A malformed optional stream must not discard the rest of the frame.
    }
  }

  return {
    updateType: update_type,
    timestamp: update.timestamp,
    egoPose: update.poses?.['/ego_pose'] ?? null,
    patches
  }
}

export function collectTransferables(frame: RawDecodedFrame): Transferable[] {
  const transferables: Transferable[] = []
  const seen = new Set<Transferable>()
  const add = (transferable: Transferable) => {
    if (seen.has(transferable)) return
    seen.add(transferable)
    transferables.push(transferable)
  }

  for (const payload of Object.values(frame.patches)) {
    if (payload._raw === 'point') {
      add(payload.points.buffer)
      if (payload.intensity) add(payload.intensity.buffer)
    } else if (payload._raw === 'polyline' || payload._raw === 'polygon') {
      add(payload.vertices.buffer)
      add(payload.offsets.buffer)
    } else if (payload._raw === 'cuboid') {
      add(payload.centers.buffer)
      add(payload.sizes.buffer)
      add(payload.rotations.buffer)
      add(payload.classIds.buffer)
      if (payload.trackIds) add(payload.trackIds.buffer)
      if (payload.scores) add(payload.scores.buffer)
    } else {
      add(payload.bytes)
    }
  }

  return transferables
}

export class FrameDecoderDestroyedError extends Error {
  constructor() {
    super('FrameDecoder destroyed')
    this.name = 'FrameDecoderDestroyedError'
  }
}

function createFrameDecoderWorker(): Worker {
  return new Worker(new URL('./workers/frameDecoder.worker.ts', import.meta.url), {
    type: 'module'
  })
}

export class FrameDecoder {
  private worker: Worker | null = null
  private readonly pending = new Map<number, PendingDecode>()
  private nextRequestId = 1
  private isDestroyed = false

  constructor(
    private readonly streamsMeta: Record<string, StreamMeta>,
    workerFactory?: WorkerFactory | null
  ) {
    const resolvedWorkerFactory =
      workerFactory === undefined
        ? typeof Worker === 'undefined'
          ? null
          : createFrameDecoderWorker
        : workerFactory
    if (!resolvedWorkerFactory) return

    try {
      this.worker = resolvedWorkerFactory()
      this.worker.onmessage = (event: MessageEvent<unknown>) => {
        if (!isFrameDecodeResponse(event.data)) return
        const pendingDecode = this.pending.get(event.data.id)
        if (!pendingDecode) return
        this.pending.delete(event.data.id)
        if (event.data.ok) pendingDecode.resolve(event.data.decodedFrame)
        else pendingDecode.reject(new Error(event.data.error))
      }
      this.worker.onerror = event => {
        this.rejectAll(new Error(event.message || 'Frame decoder Worker error'))
        this.worker?.terminate()
        this.worker = null
      }
      this.worker.postMessage({ type: 'init', streamsMeta })
    } catch {
      this.worker?.terminate()
      this.worker = null
    }
  }

  decode(buffer: ArrayBuffer): Promise<RawDecodedFrame> {
    if (this.isDestroyed) return Promise.reject(new FrameDecoderDestroyedError())
    const worker = this.worker
    if (!worker) {
      try {
        return Promise.resolve(decodeFrame(buffer, this.streamsMeta))
      } catch (error) {
        return Promise.reject(error instanceof Error ? error : new Error(String(error)))
      }
    }

    const id = this.nextRequestId++
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      try {
        worker.postMessage({ type: 'decode', id, buffer }, [buffer])
      } catch (error) {
        this.pending.delete(id)
        reject(error instanceof Error ? error : new Error(String(error)))
      }
    })
  }

  destroy(): void {
    if (this.isDestroyed) return
    this.isDestroyed = true
    this.rejectAll(new FrameDecoderDestroyedError())
    this.worker?.terminate()
    this.worker = null
  }

  private rejectAll(error: Error): void {
    for (const pendingDecode of this.pending.values()) pendingDecode.reject(error)
    this.pending.clear()
  }
}
