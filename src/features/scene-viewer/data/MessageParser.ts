import { parseGlb, readAccessor, readImageBytes, readUint8Accessor } from './GlbReader'
import type { GlbJson } from './GlbReader'
import type {
  EgoPose,
  SceneMetadata,
  SceneStatistics,
  ObjectCountSeries,
  StreamMeta,
  ImageBounds,
  CameraInfo,
  ParsedFrame,
  RawStreamPayload
} from '../types'

interface NuvizAccessorRef {
  frame_indices?: string
  values?: string
}

interface NuvizStatisticsRaw {
  ego_state?: {
    speed?: NuvizAccessorRef
    acceleration?: NuvizAccessorRef
  }
  object_counts?: Record<
    string,
    {
      total?: NuvizAccessorRef
      categories?: Record<string, NuvizAccessorRef>
    }
  >
  metrics?: Record<string, { values?: string; dtype?: string }>
  timeline?: NuvizAccessorRef
}

interface NuvizMetadataData {
  streams?: Record<string, { type: string; coordinate?: string; category?: string }>
  cameras?: Record<string, CameraInfo>
  statistics?: NuvizStatisticsRaw
  map?: Record<string, unknown>
  scene_name?: string
  scene_description?: string
}

interface NuvizMetadataRoot {
  nuviz: {
    type: string
    data: NuvizMetadataData
  }
}

interface NuvizStateUpdateRoot {
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

interface PendingParse {
  resolve: (frame: ParsedFrame) => void
  reject: (error: Error) => void
}

type WorkerFactory = () => Worker

export type MessageParserRequest =
  | { type: 'init'; streamsMeta: Record<string, StreamMeta> }
  | { type: 'parse-frame'; id: number; buffer: ArrayBuffer }

export type MessageParserResponse =
  | { id: number; ok: true; frame: ParsedFrame }
  | { id: number; ok: false; error: string }

function expandSparse(
  frameIndices: ArrayLike<number>,
  values: ArrayLike<number>,
  frameCount: number
): Float32Array<ArrayBuffer> {
  const dense = new Float32Array(frameCount)
  const valueCount = Math.min(frameIndices.length, values.length)
  for (let i = 0; i < valueCount; i++) {
    const idx = frameIndices[i]
    if (idx >= 0 && idx < frameCount) dense[idx] = values[i]
  }
  return dense
}

function readOptional<T>(reader: () => T): T | null {
  try {
    return reader()
  } catch {
    return null
  }
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error))
}

function readFloatAccessor(json: GlbJson, bin: DataView, ref: string): Float32Array {
  return (readAccessor(json, bin, ref) as Float32Array).slice()
}

function readSparseSeries(
  json: GlbJson,
  bin: DataView,
  ref: NuvizAccessorRef | undefined,
  frameCount: number
): Float32Array | null {
  if (!ref?.frame_indices || !ref.values) return null
  const frameIndicesRef = ref.frame_indices
  const valuesRef = ref.values
  return readOptional(() => {
    const frameIndices = readAccessor(json, bin, frameIndicesRef) as Uint32Array
    const values = readAccessor(json, bin, valuesRef) as Uint32Array
    return expandSparse(frameIndices, values, frameCount)
  })
}

function parseStatistics(
  stats: NuvizStatisticsRaw,
  json: GlbJson,
  bin: DataView,
  frameCount: number
): SceneStatistics {
  const speedRef = stats.ego_state?.speed?.values
  const accelerationRef = stats.ego_state?.acceleration?.values
  const egoSpeed = speedRef ? readOptional(() => readFloatAccessor(json, bin, speedRef)) : null
  const egoAcceleration = accelerationRef
    ? readOptional(() => readFloatAccessor(json, bin, accelerationRef))
    : null

  const objectCounts: Record<string, ObjectCountSeries> = {}
  const rawCounts = stats?.object_counts
  if (rawCounts) {
    for (const [streamName, series] of Object.entries(rawCounts)) {
      const total =
        readSparseSeries(json, bin, series.total, frameCount) ?? new Float32Array(frameCount)

      const categories: Record<string, Float32Array> = {}
      for (const [categoryName, category] of Object.entries(series.categories ?? {})) {
        const values = readSparseSeries(json, bin, category, frameCount)
        if (values) categories[categoryName] = values
      }

      objectCounts[streamName] = { total, categories }
    }
  }

  const metrics: Record<string, Float32Array> = {}
  if (stats?.metrics) {
    for (const [metricName, metric] of Object.entries(stats.metrics)) {
      if (!metric.values) continue
      const valuesRef = metric.values
      const values = readOptional(() => {
        if (metric.dtype === 'uint8') {
          const raw = readUint8Accessor(json, bin, valuesRef)
          const f32 = new Float32Array(raw.length)
          for (let i = 0; i < raw.length; i++) f32[i] = raw[i]
          return f32
        }
        return readFloatAccessor(json, bin, valuesRef)
      })
      if (values) metrics[metricName] = values
    }
  }

  return { frameCount, egoSpeed, egoAcceleration, objectCounts, metrics }
}

function hasImageBounds(bounds: unknown): bounds is ImageBounds {
  return (
    typeof bounds === 'object' &&
    bounds !== null &&
    'min_x' in bounds &&
    'min_y' in bounds &&
    'max_x' in bounds &&
    'max_y' in bounds
  )
}

function parsePointPayload(
  json: GlbJson,
  bin: DataView,
  payload: Record<string, unknown>
): RawStreamPayload {
  const points = (readAccessor(json, bin, payload.points as string) as Float32Array).slice()
  const intensity =
    typeof payload.INTENSITY === 'string'
      ? (readAccessor(json, bin, payload.INTENSITY) as Float32Array).slice()
      : null
  return { _raw: 'point', points, intensity }
}

function parsePathPayload(
  json: GlbJson,
  bin: DataView,
  payload: Record<string, unknown>,
  streamType: StreamMeta['type'] | undefined,
  fallbackType: 'polyline' | 'polygon'
): RawStreamPayload {
  const vertices = (readAccessor(json, bin, payload.vertices as string) as Float32Array).slice()
  const offsets = (readAccessor(json, bin, payload.offsets as string) as Uint32Array).slice()
  const type = streamType === 'polyline' || streamType === 'polygon' ? streamType : fallbackType
  return {
    _raw: type,
    vertices,
    offsets,
    count: (payload.count as number) ?? offsets.length - 1
  }
}

function parseCuboidPayload(
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

function parseImagePayload(
  json: GlbJson,
  bin: DataView,
  payload: Record<string, unknown>
): RawStreamPayload {
  const { bytes, mimeType } = readImageBytes(json, bin, payload.image as string)
  return {
    _raw: 'image',
    bytes,
    mimeType,
    width: (payload.width as number) ?? 0,
    height: (payload.height as number) ?? 0,
    bounds: hasImageBounds(payload.bounds) ? payload.bounds : undefined
  }
}

function parseStreamPayload(
  json: GlbJson,
  bin: DataView,
  payload: Record<string, unknown>,
  streamType: StreamMeta['type'] | undefined,
  fallbackPathType: 'polyline' | 'polygon'
): RawStreamPayload | null {
  return readOptional(() => {
    if (typeof payload.points === 'string') return parsePointPayload(json, bin, payload)
    if (typeof payload.vertices === 'string' && typeof payload.offsets === 'string') {
      return parsePathPayload(json, bin, payload, streamType, fallbackPathType)
    }
    if (typeof payload.CENTER === 'string') return parseCuboidPayload(json, bin, payload)
    if (typeof payload.image === 'string') return parseImagePayload(json, bin, payload)
    return null
  })
}

export interface RawMetadataParseResult {
  metadata: SceneMetadata
  initialStreamState: Record<string, RawStreamPayload>
}

export function parseMetadata(
  buffer: ArrayBuffer,
  totalFrames: number,
  logInfo: { start_time: number; end_time: number }
): RawMetadataParseResult {
  const { json, bin } = parseGlb(buffer)
  const root = json as unknown as NuvizMetadataRoot
  const data = root.nuviz.data

  const rawStreams = data.streams ?? {}

  const streams: Record<string, StreamMeta> = {}
  for (const [name, meta] of Object.entries(rawStreams)) {
    streams[name] = {
      type: meta.type as StreamMeta['type'],
      coordinate: (meta.coordinate as StreamMeta['coordinate']) ?? 'world',
      category: meta.category ?? 'PRIMITIVE'
    }
  }

  const cameras: Record<string, CameraInfo> = data.cameras ?? {}

  const stats: NuvizStatisticsRaw | undefined = data.statistics
  const timelineRef = stats?.timeline?.values
  const timestamps = timelineRef
    ? readOptional(() => readFloatAccessor(json, bin, timelineRef))
    : null

  const statistics = stats ? parseStatistics(stats, json, bin, totalFrames) : null

  const sceneName: string = typeof data.scene_name === 'string' ? data.scene_name : ''
  const sceneDescription: string =
    typeof data.scene_description === 'string' ? data.scene_description : ''

  const metadata: SceneMetadata = {
    streams,
    cameras,
    totalFrames,
    logInfo,
    timestamps,
    statistics,
    sceneName,
    sceneDescription
  }

  const initialStreamState: Record<string, RawStreamPayload> = {}
  for (const [streamName, payload] of Object.entries(data.map ?? {})) {
    if (!payload || typeof payload !== 'object') continue
    const parsed = parseStreamPayload(
      json,
      bin,
      payload as Record<string, unknown>,
      streams[streamName]?.type,
      'polygon'
    )
    if (parsed) initialStreamState[streamName] = parsed
  }

  return { metadata, initialStreamState }
}

export function parseFrame(
  buffer: ArrayBuffer,
  streamsMeta: Record<string, StreamMeta>
): ParsedFrame {
  const { json, bin } = parseGlb(buffer)
  const root = json as unknown as NuvizStateUpdateRoot
  const { update_type: updateType, updates } = root.nuviz.data
  const update = updates[0]
  if (!update) throw new Error('Frame message has no state update')

  const patches: Record<string, RawStreamPayload> = {}
  for (const [streamName, rawPayload] of Object.entries(update.primitives ?? {})) {
    if (!rawPayload || typeof rawPayload !== 'object') continue
    const parsed = parseStreamPayload(
      json,
      bin,
      rawPayload as Record<string, unknown>,
      streamsMeta[streamName]?.type,
      'polyline'
    )
    if (parsed) patches[streamName] = parsed
  }

  return {
    updateType,
    timestamp: update.timestamp,
    egoPose: update.poses?.['/ego_pose'] ?? null,
    patches
  }
}

export function collectTransferables(frame: ParsedFrame): Transferable[] {
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

function isMessageParserResponse(data: unknown): data is MessageParserResponse {
  if (!data || typeof data !== 'object') return false
  const response = data as Record<string, unknown>
  if (typeof response.id !== 'number' || typeof response.ok !== 'boolean') return false
  return response.ok ? 'frame' in response : typeof response.error === 'string'
}

export class MessageParserDestroyedError extends Error {
  constructor() {
    super('MessageParser destroyed')
    this.name = 'MessageParserDestroyedError'
  }
}

function createMessageParserWorker(): Worker {
  return new Worker(new URL('./MessageParser.worker.ts', import.meta.url), {
    type: 'module'
  })
}

export class MessageParser {
  private worker: Worker | null = null
  private readonly pending = new Map<number, PendingParse>()
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
          : createMessageParserWorker
        : workerFactory
    if (!resolvedWorkerFactory) return

    try {
      this.worker = resolvedWorkerFactory()
      this.worker.onmessage = (event: MessageEvent<unknown>) => {
        if (!isMessageParserResponse(event.data)) return
        const pendingParse = this.pending.get(event.data.id)
        if (!pendingParse) return
        this.pending.delete(event.data.id)
        if (event.data.ok) pendingParse.resolve(event.data.frame)
        else pendingParse.reject(new Error(event.data.error))
      }
      this.worker.onerror = event => {
        this.rejectAll(new Error(event.message || 'Message parser Worker error'))
        this.worker?.terminate()
        this.worker = null
      }
      this.worker.postMessage({ type: 'init', streamsMeta })
    } catch {
      this.worker?.terminate()
      this.worker = null
    }
  }

  parseFrame(buffer: ArrayBuffer): Promise<ParsedFrame> {
    if (this.isDestroyed) return Promise.reject(new MessageParserDestroyedError())
    const worker = this.worker
    if (!worker) {
      try {
        return Promise.resolve(parseFrame(buffer, this.streamsMeta))
      } catch (error) {
        return Promise.reject(toError(error))
      }
    }

    const id = this.nextRequestId++
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      try {
        worker.postMessage({ type: 'parse-frame', id, buffer }, [buffer])
      } catch (error) {
        this.pending.delete(id)
        reject(toError(error))
      }
    })
  }

  destroy(): void {
    if (this.isDestroyed) return
    this.isDestroyed = true
    this.rejectAll(new MessageParserDestroyedError())
    this.worker?.terminate()
    this.worker = null
  }

  private rejectAll(error: Error): void {
    for (const pendingParse of this.pending.values()) pendingParse.reject(error)
    this.pending.clear()
  }
}
