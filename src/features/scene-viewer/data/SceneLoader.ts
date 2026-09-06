import { MessageParser, parseMetadata } from './MessageParser'
import type {
  EgoPose,
  MessageIndex,
  ParsedFrame,
  RawStreamPayload,
  SceneMetadata,
  StreamPayload
} from '../types'

const PREFETCH_BACK = 15
const PREFETCH_FORWARD = 10
const MAX_CACHED_FRAMES = PREFETCH_BACK + PREFETCH_FORWARD + 1 // 26 slots
const MAX_CONCURRENT_FRAME_LOADS = 2

type FrameLoadPriority = 'critical' | 'background'

interface QueuedFrameLoad {
  frameIndex: number
  priority: FrameLoadPriority
  resolve: (entry: LoadedFrame) => void
  reject: (error: Error) => void
}

type CacheChangeListener = () => void

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error))
}

function revokeUrls(urls: Iterable<string>): void {
  for (const url of urls) URL.revokeObjectURL(url)
}

async function fetchArrayBuffer(url: string, signal: AbortSignal): Promise<ArrayBuffer> {
  const response = await fetch(url, { signal })
  if (!response.ok) throw new Error(`Failed to fetch ${url}: ${response.status}`)
  return response.arrayBuffer()
}

function materializePatches(rawPatches: Record<string, RawStreamPayload>): {
  patches: Record<string, StreamPayload>
  imageUrls: string[]
} {
  const patches: Record<string, StreamPayload> = {}
  const imageUrls: string[] = []

  try {
    for (const [streamName, payload] of Object.entries(rawPatches)) {
      switch (payload._raw) {
        case 'point':
          patches[streamName] = {
            type: 'point',
            points: payload.points,
            intensity: payload.intensity
          }
          break
        case 'polyline':
          patches[streamName] = {
            type: 'polyline',
            vertices: payload.vertices,
            offsets: payload.offsets,
            count: payload.count
          }
          break
        case 'polygon':
          patches[streamName] = {
            type: 'polygon',
            vertices: payload.vertices,
            offsets: payload.offsets,
            count: payload.count
          }
          break
        case 'cuboid':
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
          break
        case 'image': {
          const url = URL.createObjectURL(new Blob([payload.bytes], { type: payload.mimeType }))
          imageUrls.push(url)
          patches[streamName] = {
            type: 'image',
            url,
            width: payload.width,
            height: payload.height,
            bounds: payload.bounds
          }
          break
        }
      }
    }
  } catch (error) {
    revokeUrls(imageUrls)
    throw error
  }

  return { patches, imageUrls }
}

export interface SceneLoadResult {
  metadata: SceneMetadata
  initialStreamState: Record<string, StreamPayload>
  initialFrame: LoadedFrame | null
}

export type LoadedFrame = {
  updateType: 'COMPLETE_STATE' | 'INCREMENTAL'
  egoPose: EgoPose | null
  patches: Record<string, StreamPayload>
  imageUrls: string[]
}

export class SceneLoader {
  private readonly baseUrl: string
  private readonly lifecycleAbortController = new AbortController()
  private parser: MessageParser | null = null
  private readonly cache = new Map<number, LoadedFrame>()
  private readonly inFlight = new Map<number, Promise<LoadedFrame>>()
  private readonly queuedFrameLoads = new Map<number, QueuedFrameLoad>()
  private activeFrameLoads = 0

  private messageIndex: MessageIndex | null = null
  private readonly staticImageUrls: string[] = []
  private isDestroyed = false
  private readonly cacheChangeListeners = new Set<CacheChangeListener>()

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

  subscribeCacheChanges(listener: CacheChangeListener): () => void {
    this.cacheChangeListeners.add(listener)
    return () => this.cacheChangeListeners.delete(listener)
  }

  async init(): Promise<SceneLoadResult> {
    const indexBuffer = await fetchArrayBuffer(
      `${this.baseUrl}message_index.json`,
      this.lifecycleAbortController.signal
    )
    this.messageIndex = JSON.parse(new TextDecoder().decode(indexBuffer)) as MessageIndex

    const messages = this.messageIndex.messages
    const metadataFile = this.messageIndex.metadata ?? 'metadata.glb'

    // Download frame 0 in parallel with metadata. Parsing waits for stream metadata.
    let frame0BufferPromise: Promise<ArrayBuffer> | null = null
    if (messages.length > 0 && !this.isDestroyed) {
      frame0BufferPromise = fetchArrayBuffer(
        `${this.baseUrl}${messages[0].file}`,
        this.lifecycleAbortController.signal
      )
      void frame0BufferPromise.catch(() => {})
    }

    const metadataBuffer = await fetchArrayBuffer(
      `${this.baseUrl}${metadataFile}`,
      this.lifecycleAbortController.signal
    )

    this.assertActive()
    const parsedMetadata = parseMetadata(
      metadataBuffer,
      messages.length,
      this.messageIndex.log_info
    )
    const staticStreams = materializePatches(parsedMetadata.initialStreamState)
    this.staticImageUrls.push(...staticStreams.imageUrls)
    const parser = new MessageParser(parsedMetadata.metadata.streams)
    this.parser = parser

    const initialFrame = frame0BufferPromise
      ? this.commitParsedFrame(0, await parser.parseFrame(await frame0BufferPromise))
      : null

    return {
      metadata: parsedMetadata.metadata,
      initialStreamState: staticStreams.patches,
      initialFrame
    }
  }

  async loadFrame(frameIndex: number): Promise<LoadedFrame> {
    this.assertActive()
    if (!this.messageIndex || !this.parser) throw new Error('SceneLoader not initialised')
    return this.enqueueFrameLoad(frameIndex, 'critical')
  }

  prefetchAround(centerIndex: number): void {
    if (!this.messageIndex || this.isDestroyed) return
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
    if (this.isDestroyed) return
    this.isDestroyed = true
    this.lifecycleAbortController.abort()
    for (const queued of this.queuedFrameLoads.values()) {
      queued.reject(new Error('SceneLoader destroyed'))
    }
    this.queuedFrameLoads.clear()
    this.parser?.destroy()
    this.parser = null
    for (const entry of this.cache.values()) {
      revokeUrls(entry.imageUrls)
    }
    this.cache.clear()
    revokeUrls(this.staticImageUrls)
    this.staticImageUrls.length = 0
    this.cacheChangeListeners.clear()
  }

  private enqueueFrameLoad(frameIndex: number, priority: FrameLoadPriority): Promise<LoadedFrame> {
    const cached = this.cache.get(frameIndex)
    if (cached) return Promise.resolve(cached)

    const existing = this.inFlight.get(frameIndex)
    if (existing) {
      const queued = this.queuedFrameLoads.get(frameIndex)
      if (queued && priority === 'critical') queued.priority = 'critical'
      return existing
    }

    const promise = new Promise<LoadedFrame>((resolve, reject) => {
      this.queuedFrameLoads.set(frameIndex, { frameIndex, priority, resolve, reject })
    })
    this.trackInFlight(frameIndex, promise)
    this.drainFrameQueue()
    return promise
  }

  private trackInFlight(frameIndex: number, promise: Promise<LoadedFrame>): void {
    this.inFlight.set(frameIndex, promise)
    promise.then(
      () => this.inFlight.delete(frameIndex),
      () => this.inFlight.delete(frameIndex)
    )
  }

  private drainFrameQueue(): void {
    while (!this.isDestroyed && this.activeFrameLoads < MAX_CONCURRENT_FRAME_LOADS) {
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
          err => next.reject(toError(err))
        )
        .finally(() => {
          this.activeFrameLoads--
          this.drainFrameQueue()
        })
    }
  }

  private async fetchAndMaterializeFrame(frameIndex: number): Promise<LoadedFrame> {
    if (!this.messageIndex || !this.parser) throw new Error('SceneLoader not initialised')
    const parser = this.parser
    this.assertActive()
    const entry = this.messageIndex.messages[frameIndex]
    if (!entry) throw new Error(`Frame ${frameIndex} not found`)

    const buffer = await fetchArrayBuffer(
      `${this.baseUrl}${entry.file}`,
      this.lifecycleAbortController.signal
    )
    const raw = await parser.parseFrame(buffer)
    this.assertActive()
    return this.commitParsedFrame(frameIndex, raw)
  }

  private commitParsedFrame(frameIndex: number, raw: ParsedFrame): LoadedFrame {
    this.assertActive()
    const { patches, imageUrls } = materializePatches(raw.patches)
    const materialized: LoadedFrame = {
      updateType: raw.updateType,
      egoPose: raw.egoPose,
      patches,
      imageUrls
    }

    this.cache.set(frameIndex, materialized)
    this.notifyCacheChanges()
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
      if (evicted) revokeUrls(evicted.imageUrls)
      this.cache.delete(key)
    }
  }

  private notifyCacheChanges(): void {
    for (const listener of this.cacheChangeListeners) listener()
  }

  private assertActive(): void {
    if (this.isDestroyed) throw new Error('SceneLoader destroyed')
  }
}
