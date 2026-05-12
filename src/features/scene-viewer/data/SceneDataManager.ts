import { parseMetadata } from './MetadataParser'
import { parseMessage } from './MessageParser'
import { isWorkerParseResponse } from './workers/workerMessages'
import type { EgoPose, MessageIndex, RawDecodedFrame, StreamMeta, StreamPayload } from '../types'
import type { MetadataParseResult } from './MetadataParser'

const PREFETCH_BACK = 15
const PREFETCH_FORWARD = 10
const MAX_CACHED_FRAMES = PREFETCH_BACK + PREFETCH_FORWARD + 1 // 26 slots

interface PendingParse {
  resolve: (frame: RawDecodedFrame) => void
  reject: (err: Error) => void
}

class MessageParserWorker {
  private worker: Worker | null = null
  private nextId = 1
  private pending = new Map<number, PendingParse>()

  constructor() {
    if (typeof Worker === 'undefined') return
    try {
      this.worker = new Worker(new URL('./workers/messageParse.worker.ts', import.meta.url), {
        type: 'module'
      })
      this.worker.onmessage = (e: MessageEvent<unknown>) => {
        if (!isWorkerParseResponse(e.data)) return
        const { id } = e.data
        const p = this.pending.get(id)
        if (!p) return
        this.pending.delete(id)
        if (e.data.ok) {
          p.resolve(e.data.frame)
        } else {
          p.reject(new Error(e.data.error))
        }
      }
      this.worker.onerror = e => {
        this.rejectAll(new Error(e.message || 'Worker error'))
      }
    } catch {
      this.worker = null
    }
  }

  setStreamsMeta(streamsMeta: Record<string, StreamMeta>): void {
    this.worker?.postMessage({ type: 'init', streamsMeta })
  }

  parse(buffer: ArrayBuffer): Promise<RawDecodedFrame> {
    if (!this.worker) {
      return Promise.resolve(parseMessage(buffer))
    }
    const id = this.nextId++
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      this.worker!.postMessage({ type: 'parse', id, buffer }, [buffer])
    })
  }

  destroy() {
    this.rejectAll(new Error('Worker destroyed'))
    this.worker?.terminate()
    this.worker = null
  }

  private rejectAll(err: Error) {
    for (const p of this.pending.values()) p.reject(err)
    this.pending.clear()
  }
}

function materializeFrame(raw: RawDecodedFrame): {
  patches: Record<string, StreamPayload>
  imageUrls: string[]
} {
  const patches: Record<string, StreamPayload> = {}
  const imageUrls: string[] = []

  for (const [streamName, payload] of Object.entries(raw.patches)) {
    if (payload._raw === 'point') {
      patches[streamName] = { type: 'point', points: payload.points, intensity: payload.intensity }
    } else if (payload._raw === 'polyline') {
      patches[streamName] = {
        type: 'polyline',
        vertices: payload.vertices,
        offsets: payload.offsets,
        count: payload.count
      }
    } else if (payload._raw === 'polygon') {
      patches[streamName] = {
        type: 'polygon',
        vertices: payload.vertices,
        offsets: payload.offsets,
        count: payload.count
      }
    } else if (payload._raw === 'cuboid') {
      patches[streamName] = {
        type: 'cuboid',
        centers: payload.centers,
        sizes: payload.sizes,
        rotations: payload.rotations,
        classIds: payload.classIds,
        trackIds: payload.trackIds,
        scores: payload.scores,
        count: payload.count
      }
    } else if (payload._raw === 'image') {
      const url = URL.createObjectURL(new Blob([payload.bytes], { type: payload.mimeType }))
      imageUrls.push(url)
      patches[streamName] = {
        type: 'image',
        url,
        width: payload.width,
        height: payload.height,
        bounds: payload.bounds
      }
    }
  }

  return { patches, imageUrls }
}

export type FrameCacheEntry = {
  updateType: 'COMPLETE_STATE' | 'INCREMENTAL'
  egoPose: EgoPose | null
  patches: Record<string, StreamPayload>
  imageUrls: string[]
}

export class SceneDataManager {
  private readonly baseUrl: string
  private readonly worker = new MessageParserWorker()
  private readonly cache = new Map<number, FrameCacheEntry>()
  private readonly inFlight = new Map<number, Promise<FrameCacheEntry>>()

  private messageIndex: MessageIndex | null = null
  private streamsMeta: Record<string, StreamMeta> = {}
  private metadataResult: MetadataParseResult | null = null
  private destroyed = false

  onCacheUpdate?: () => void

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`
  }

  getBufferEndFrame(fromFrame: number): number {
    const total = this.messageIndex?.messages.length ?? 0
    let end = fromFrame
    while (end + 1 < total && (this.cache.has(end + 1) || this.inFlight.has(end + 1))) {
      end++
    }
    return end
  }

  async init(): Promise<MetadataParseResult> {
    const idxRes = await fetch(`${this.baseUrl}message_index.json`)
    if (!idxRes.ok) throw new Error(`Failed to fetch message_index.json: ${idxRes.status}`)
    this.messageIndex = (await idxRes.json()) as MessageIndex

    const messages = this.messageIndex.messages
    const metadataFile = this.messageIndex.metadata ?? 'metadata.glb'

    // Start fetching frame 0's raw bytes in parallel with metadata.glb.
    // We do NOT parse yet — parsing must happen after setStreamsMeta.
    let frame0BufferPromise: Promise<ArrayBuffer> | null = null
    if (messages.length > 0 && !this.destroyed) {
      frame0BufferPromise = fetch(`${this.baseUrl}${messages[0].file}`).then(r => {
        if (!r.ok) throw new Error(`frame 0 prefetch: ${r.status}`)
        return r.arrayBuffer()
      })
    }

    const metaRes = await fetch(`${this.baseUrl}${metadataFile}`)
    if (!metaRes.ok) throw new Error(`Failed to fetch metadata.glb: ${metaRes.status}`)

    const result = parseMetadata(
      await metaRes.arrayBuffer(),
      messages.length,
      this.messageIndex.log_info
    )
    this.streamsMeta = result.metadata.streams
    this.metadataResult = result

    // Send streamsMeta to worker now. Worker message ordering guarantees this
    // init message is processed before any subsequent parse requests.
    this.worker.setStreamsMeta(this.streamsMeta)

    // Now enqueue frame 0 parse — worker already has streamsMeta.
    if (frame0BufferPromise && !this.destroyed) {
      const frame0Entry: Promise<FrameCacheEntry> = frame0BufferPromise
        .then(buf => this.worker.parse(buf))
        .then(raw => {
          const { patches, imageUrls } = materializeFrame(raw)
          const entry: FrameCacheEntry = {
            updateType: raw.updateType,
            egoPose: raw.egoPose,
            patches,
            imageUrls
          }
          this.cache.set(0, entry)
          this.onCacheUpdate?.()
          return entry
        })
      this.inFlight.set(0, frame0Entry)
      frame0Entry.then(
        () => this.inFlight.delete(0),
        () => this.inFlight.delete(0)
      )
    }

    return result
  }

  get index(): MessageIndex | null {
    return this.messageIndex
  }

  async loadFrame(frameIndex: number): Promise<FrameCacheEntry> {
    const cached = this.cache.get(frameIndex)
    if (cached) return cached

    const existing = this.inFlight.get(frameIndex)
    if (existing) return existing

    if (!this.messageIndex) throw new Error('SceneDataManager not initialised')
    if (this.destroyed) throw new Error('SceneDataManager destroyed')

    const entry = this.messageIndex.messages[frameIndex]
    if (!entry) throw new Error(`Frame ${frameIndex} not found`)

    const promise = (async () => {
      const res = await fetch(`${this.baseUrl}${entry.file}`)
      if (!res.ok) throw new Error(`Failed to fetch frame ${frameIndex}: ${res.status}`)

      const raw = await this.worker.parse(await res.arrayBuffer())
      const { patches, imageUrls } = materializeFrame(raw)
      const materialized: FrameCacheEntry = {
        updateType: raw.updateType,
        egoPose: raw.egoPose,
        patches,
        imageUrls
      }

      this.cache.set(frameIndex, materialized)
      this.onCacheUpdate?.()
      this.pruneCache(frameIndex)
      return materialized
    })()

    this.inFlight.set(frameIndex, promise)
    promise.then(
      () => this.inFlight.delete(frameIndex),
      () => this.inFlight.delete(frameIndex)
    )
    return promise
  }

  prefetch(centerIndex: number): void {
    if (!this.messageIndex || this.destroyed) return
    const total = this.messageIndex.messages.length

    const fwdEnd = Math.min(centerIndex + PREFETCH_FORWARD, total - 1)
    for (let i = centerIndex + 1; i <= fwdEnd; i++) {
      if (!this.cache.has(i) && !this.inFlight.has(i)) {
        void this.loadFrame(i).catch(() => {})
      }
    }

    const bwdStart = Math.max(0, centerIndex - PREFETCH_BACK)
    for (let i = bwdStart; i < centerIndex; i++) {
      if (!this.cache.has(i) && !this.inFlight.has(i)) {
        void this.loadFrame(i).catch(() => {})
      }
    }
  }

  destroy(): void {
    this.destroyed = true
    this.worker.destroy()
    for (const entry of this.cache.values()) {
      for (const url of entry.imageUrls) URL.revokeObjectURL(url)
    }
    this.cache.clear()
    if (this.metadataResult) {
      for (const url of this.metadataResult.staticImageUrls) URL.revokeObjectURL(url)
    }
  }

  private pruneCache(centerIndex: number): void {
    if (this.cache.size <= MAX_CACHED_FRAMES) return
    const outside = [...this.cache.keys()]
      .filter(k => k < centerIndex - PREFETCH_BACK || k > centerIndex + PREFETCH_FORWARD)
      .sort((a, b) => Math.abs(b - centerIndex) - Math.abs(a - centerIndex))

    for (const key of outside) {
      if (this.cache.size <= MAX_CACHED_FRAMES) break
      const evicted = this.cache.get(key)
      if (evicted) {
        for (const url of evicted.imageUrls) URL.revokeObjectURL(url)
      }
      this.cache.delete(key)
    }
  }
}
