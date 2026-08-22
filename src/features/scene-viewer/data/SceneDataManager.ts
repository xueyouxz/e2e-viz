import { parseMetadata } from './MetadataParser'
import { parseMessage } from './MessageParser'
import { isWorkerParseResponse } from './workers/workerMessages'
import type { SceneLoadingProgress } from './loadingProgress'
import type { EgoPose, MessageIndex, RawDecodedFrame, StreamMeta, StreamPayload } from '../types'
import type { MetadataParseResult } from './MetadataParser'

const PREFETCH_BACK = 15
const PREFETCH_FORWARD = 10
const MAX_CACHED_FRAMES = PREFETCH_BACK + PREFETCH_FORWARD + 1 // 26 slots
const MAX_BACKGROUND_FRAME_LOADS = 2

interface PendingParse {
  resolve: (frame: RawDecodedFrame) => void
  reject: (err: Error) => void
}

type FrameLoadPriority = 'critical' | 'background'

interface QueuedFrameLoad {
  frameIndex: number
  priority: FrameLoadPriority
  resolve: (entry: FrameCacheEntry) => void
  reject: (error: Error) => void
}

type LoadingProgressListener = (progress: SceneLoadingProgress) => void

async function fetchArrayBufferWithProgress(
  url: string,
  onProgress: (loadedBytes: number, totalBytes: number | null) => void
): Promise<ArrayBuffer> {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`Failed to fetch ${url}: ${response.status}`)

  const header = response.headers.get('content-length')
  const parsedTotal = header ? Number(header) : Number.NaN
  const totalBytes = Number.isFinite(parsedTotal) && parsedTotal > 0 ? parsedTotal : null

  if (!response.body) {
    const buffer = await response.arrayBuffer()
    onProgress(buffer.byteLength, totalBytes ?? buffer.byteLength)
    return buffer
  }

  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let loadedBytes = 0
  onProgress(0, totalBytes)

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    if (!value) continue
    chunks.push(value)
    loadedBytes += value.byteLength
    onProgress(loadedBytes, totalBytes)
  }

  const combined = new Uint8Array(loadedBytes)
  let offset = 0
  for (const chunk of chunks) {
    combined.set(chunk, offset)
    offset += chunk.byteLength
  }
  onProgress(loadedBytes, totalBytes ?? loadedBytes)
  return combined.buffer
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
  private readonly queuedFrameLoads = new Map<number, QueuedFrameLoad>()
  private activeFrameLoads = 0

  private messageIndex: MessageIndex | null = null
  private streamsMeta: Record<string, StreamMeta> = {}
  private metadataResult: MetadataParseResult | null = null
  private destroyed = false
  private metadataReadyForProgress = false
  private initialFrameProgress: Pick<SceneLoadingProgress, 'loadedBytes' | 'totalBytes'> = {
    loadedBytes: 0,
    totalBytes: null
  }
  private loadingProgress: SceneLoadingProgress = {
    phase: 'index',
    loadedBytes: 0,
    totalBytes: null
  }
  private readonly loadingProgressListeners = new Set<LoadingProgressListener>()

  onCacheUpdate?: () => void

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`
  }

  getBufferEndFrame(fromFrame: number): number {
    const total = this.messageIndex?.messages.length ?? 0
    let end = fromFrame
    while (end + 1 < total && this.cache.has(end + 1)) {
      end++
    }
    return end
  }

  getLoadingProgress(): SceneLoadingProgress {
    return this.loadingProgress
  }

  subscribeLoadingProgress(listener: LoadingProgressListener): () => void {
    this.loadingProgressListeners.add(listener)
    listener(this.loadingProgress)
    return () => this.loadingProgressListeners.delete(listener)
  }

  async init(): Promise<MetadataParseResult> {
    this.setLoadingProgress({ phase: 'index', loadedBytes: 0, totalBytes: null })
    const indexBuffer = await fetchArrayBufferWithProgress(
      `${this.baseUrl}message_index.json`,
      (loadedBytes, totalBytes) => {
        this.setLoadingProgress({ phase: 'index', loadedBytes, totalBytes })
      }
    )
    this.messageIndex = JSON.parse(new TextDecoder().decode(indexBuffer)) as MessageIndex

    const messages = this.messageIndex.messages
    const metadataFile = this.messageIndex.metadata ?? 'metadata.glb'

    // Start fetching frame 0's raw bytes in parallel with metadata.glb.
    // We do NOT parse yet — parsing must happen after setStreamsMeta.
    let frame0BufferPromise: Promise<ArrayBuffer> | null = null
    if (messages.length > 0 && !this.destroyed) {
      frame0BufferPromise = fetchArrayBufferWithProgress(
        `${this.baseUrl}${messages[0].file}`,
        (loadedBytes, totalBytes) => {
          this.initialFrameProgress = { loadedBytes, totalBytes }
          if (this.metadataReadyForProgress) {
            this.setLoadingProgress({ phase: 'first-frame', loadedBytes, totalBytes })
          }
        }
      )
    }

    const metadataBuffer = await fetchArrayBufferWithProgress(
      `${this.baseUrl}${metadataFile}`,
      (loadedBytes, totalBytes) => {
        this.setLoadingProgress({ phase: 'metadata', loadedBytes, totalBytes })
      }
    )

    const result = parseMetadata(metadataBuffer, messages.length, this.messageIndex.log_info)
    this.streamsMeta = result.metadata.streams
    this.metadataResult = result

    // Send streamsMeta to worker now. Worker message ordering guarantees this
    // init message is processed before any subsequent parse requests.
    this.worker.setStreamsMeta(this.streamsMeta)
    this.metadataReadyForProgress = true
    this.setLoadingProgress({ phase: 'first-frame', ...this.initialFrameProgress })

    // Now enqueue frame 0 parse — worker already has streamsMeta.
    if (frame0BufferPromise && !this.destroyed) {
      const frame0Entry: Promise<FrameCacheEntry> = frame0BufferPromise
        .then(buf => {
          this.setLoadingProgress({ phase: 'parsing', ...this.initialFrameProgress })
          return this.worker.parse(buf)
        })
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
          this.setLoadingProgress({ phase: 'ready', ...this.initialFrameProgress })
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
    if (existing) {
      const queued = this.queuedFrameLoads.get(frameIndex)
      if (queued) queued.priority = 'critical'
      return existing
    }

    if (!this.messageIndex) throw new Error('SceneDataManager not initialised')
    if (this.destroyed) throw new Error('SceneDataManager destroyed')

    return this.enqueueFrameLoad(frameIndex, 'critical')
  }

  prefetch(centerIndex: number): void {
    if (!this.messageIndex || this.destroyed) return
    const total = this.messageIndex.messages.length

    const fwdEnd = Math.min(centerIndex + PREFETCH_FORWARD, total - 1)
    for (let i = centerIndex + 1; i <= fwdEnd; i++) {
      if (!this.cache.has(i) && !this.inFlight.has(i)) {
        void this.enqueueFrameLoad(i, 'background').catch(() => {})
      }
    }

    const bwdStart = Math.max(0, centerIndex - PREFETCH_BACK)
    for (let i = bwdStart; i < centerIndex; i++) {
      if (!this.cache.has(i) && !this.inFlight.has(i)) {
        void this.enqueueFrameLoad(i, 'background').catch(() => {})
      }
    }
  }

  destroy(): void {
    this.destroyed = true
    for (const queued of this.queuedFrameLoads.values()) {
      queued.reject(new Error('SceneDataManager destroyed'))
    }
    this.queuedFrameLoads.clear()
    this.worker.destroy()
    for (const entry of this.cache.values()) {
      for (const url of entry.imageUrls) URL.revokeObjectURL(url)
    }
    this.cache.clear()
    if (this.metadataResult) {
      for (const url of this.metadataResult.staticImageUrls) URL.revokeObjectURL(url)
    }
  }

  private enqueueFrameLoad(
    frameIndex: number,
    priority: FrameLoadPriority
  ): Promise<FrameCacheEntry> {
    const cached = this.cache.get(frameIndex)
    if (cached) return Promise.resolve(cached)

    const existing = this.inFlight.get(frameIndex)
    if (existing) {
      const queued = this.queuedFrameLoads.get(frameIndex)
      if (queued && priority === 'critical') queued.priority = 'critical'
      return existing
    }

    const promise = new Promise<FrameCacheEntry>((resolve, reject) => {
      this.queuedFrameLoads.set(frameIndex, { frameIndex, priority, resolve, reject })
    })
    this.inFlight.set(frameIndex, promise)
    promise.then(
      () => this.inFlight.delete(frameIndex),
      () => this.inFlight.delete(frameIndex)
    )
    this.drainFrameQueue()
    return promise
  }

  private drainFrameQueue(): void {
    while (!this.destroyed && this.activeFrameLoads < MAX_BACKGROUND_FRAME_LOADS) {
      const next = [...this.queuedFrameLoads.values()].sort((a, b) => {
        if (a.priority === b.priority) return a.frameIndex - b.frameIndex
        return a.priority === 'critical' ? -1 : 1
      })[0]
      if (!next) return

      this.queuedFrameLoads.delete(next.frameIndex)
      this.activeFrameLoads++
      void this.fetchAndMaterializeFrame(next.frameIndex)
        .then(
          entry => next.resolve(entry),
          err => next.reject(err instanceof Error ? err : new Error(String(err)))
        )
        .finally(() => {
          this.activeFrameLoads--
          this.drainFrameQueue()
        })
    }
  }

  private async fetchAndMaterializeFrame(frameIndex: number): Promise<FrameCacheEntry> {
    if (!this.messageIndex) throw new Error('SceneDataManager not initialised')
    if (this.destroyed) throw new Error('SceneDataManager destroyed')
    const entry = this.messageIndex.messages[frameIndex]
    if (!entry) throw new Error(`Frame ${frameIndex} not found`)

    const response = await fetch(`${this.baseUrl}${entry.file}`)
    if (!response.ok) throw new Error(`Failed to fetch frame ${frameIndex}: ${response.status}`)

    const raw = await this.worker.parse(await response.arrayBuffer())
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

  private setLoadingProgress(progress: SceneLoadingProgress): void {
    this.loadingProgress = progress
    for (const listener of this.loadingProgressListeners) listener(progress)
  }
}
