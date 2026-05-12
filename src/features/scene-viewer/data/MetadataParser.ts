import { parseGlb, readAccessor, readImageBytes, readUint8Accessor } from './GlbReader'
import type { GlbJson } from './GlbReader'
import type {
  SceneMetadata,
  SceneStatistics,
  ObjectCountSeries,
  StreamMeta,
  StreamPayload,
  PolygonPayload,
  ImagePayload,
  ImageBounds,
  CameraInfo
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

function expandSparse(
  frameIndices: ArrayLike<number>,
  values: ArrayLike<number>,
  frameCount: number
): Float32Array<ArrayBuffer> {
  const dense = new Float32Array(frameCount)
  for (let i = 0; i < frameIndices.length; i++) {
    const idx = frameIndices[i]
    if (idx < frameCount) dense[idx] = values[i]
  }
  return dense
}

function parseStatistics(
  stats: NuvizStatisticsRaw,
  json: GlbJson,
  bin: DataView,
  frameCount: number
): SceneStatistics {
  let egoSpeed: Float32Array | null = null
  let egoAcceleration: Float32Array | null = null

  try {
    if (stats?.ego_state?.speed?.values) {
      egoSpeed = (readAccessor(json, bin, stats.ego_state.speed.values) as Float32Array).slice()
    }
  } catch {
    /* optional field */
  }

  try {
    if (stats?.ego_state?.acceleration?.values) {
      egoAcceleration = (
        readAccessor(json, bin, stats.ego_state.acceleration.values) as Float32Array
      ).slice()
    }
  } catch {
    /* optional field */
  }

  const objectCounts: Record<string, ObjectCountSeries> = {}
  const rawCounts = stats?.object_counts
  if (rawCounts) {
    for (const [streamName, series] of Object.entries(rawCounts)) {
      let total = new Float32Array(frameCount)
      try {
        if (series.total?.frame_indices && series.total?.values) {
          const fi = (readAccessor(json, bin, series.total.frame_indices) as Uint32Array).slice()
          const vs = (readAccessor(json, bin, series.total.values) as Uint32Array).slice()
          total = expandSparse(fi, vs, frameCount)
        }
      } catch {
        /* optional */
      }

      const categories: Record<string, Float32Array> = {}
      if (series.categories) {
        for (const [catName, cat] of Object.entries(series.categories)) {
          try {
            if (cat.frame_indices && cat.values) {
              const fi = (readAccessor(json, bin, cat.frame_indices) as Uint32Array).slice()
              const vs = (readAccessor(json, bin, cat.values) as Uint32Array).slice()
              categories[catName] = expandSparse(fi, vs, frameCount)
            }
          } catch {
            /* optional */
          }
        }
      }

      objectCounts[streamName] = { total, categories }
    }
  }

  const metrics: Record<string, Float32Array> = {}
  if (stats?.metrics) {
    for (const [metricName, metric] of Object.entries(stats.metrics)) {
      if (!metric.values) continue
      try {
        if (metric.dtype === 'uint8') {
          const raw = readUint8Accessor(json, bin, metric.values)
          const f32 = new Float32Array(raw.length)
          for (let i = 0; i < raw.length; i++) f32[i] = raw[i]
          metrics[metricName] = f32
        } else {
          metrics[metricName] = (readAccessor(json, bin, metric.values) as Float32Array).slice()
        }
      } catch {
        /* optional */
      }
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

export interface MetadataParseResult {
  metadata: SceneMetadata
  initialStreamState: Record<string, StreamPayload>
  staticImageUrls: string[]
}

export function parseMetadata(
  buffer: ArrayBuffer,
  totalFrames: number,
  logInfo: { start_time: number; end_time: number }
): MetadataParseResult {
  const { json, bin } = parseGlb(buffer)
  const root = json as unknown as NuvizMetadataRoot
  const data = root.nuviz.data

  // ── Streams ────────────────────────────────────────────────────────────────
  const rawStreams = data.streams ?? {}

  const streams: Record<string, StreamMeta> = {}
  for (const [name, meta] of Object.entries(rawStreams)) {
    streams[name] = {
      type: meta.type as StreamMeta['type'],
      coordinate: (meta.coordinate as StreamMeta['coordinate']) ?? 'world',
      category: meta.category ?? 'PRIMITIVE'
    }
  }

  // ── Cameras ────────────────────────────────────────────────────────────────
  const cameras: Record<string, CameraInfo> = data.cameras ?? {}

  // ── Statistics / timeline ─────────────────────────────────────────────────
  let timestamps: Float32Array | null = null
  const stats: NuvizStatisticsRaw | undefined = data.statistics
  if (stats?.timeline?.values) {
    try {
      timestamps = (readAccessor(json, bin, stats.timeline.values) as Float32Array).slice()
    } catch {
      timestamps = null
    }
  }

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

  // ── Static map stream payloads → initialStreamState ───────────────────────
  const initialStreamState: Record<string, StreamPayload> = {}
  const staticImageUrls: string[] = []

  const mapData: Record<string, unknown> = data.map ?? {}

  for (const [streamName, payload] of Object.entries(mapData)) {
    if (!payload || typeof payload !== 'object') continue

    const p = payload as Record<string, unknown>

    if ('image' in p && typeof p.image === 'string') {
      // Image stream (e.g. /map/basemap)
      try {
        const { bytes, mimeType } = readImageBytes(json, bin, p.image as string)
        const url = URL.createObjectURL(new Blob([bytes], { type: mimeType }))
        staticImageUrls.push(url)

        const imgPayload: ImagePayload = {
          type: 'image',
          url,
          width: (p.width as number) ?? 0,
          height: (p.height as number) ?? 0,
          bounds: hasImageBounds(p.bounds) ? p.bounds : undefined
        }
        initialStreamState[streamName] = imgPayload
      } catch {
        // skip malformed image entries
      }
    } else if ('vertices' in p && 'offsets' in p && typeof p.vertices === 'string') {
      // Polygon stream (e.g. /gt/map/lane)
      try {
        const vertices = (readAccessor(json, bin, p.vertices as string) as Float32Array).slice()
        const offsets = (readAccessor(json, bin, p.offsets as string) as Uint32Array).slice()
        const count = (p.count as number) ?? offsets.length - 1

        const polyPayload: PolygonPayload = { type: 'polygon', vertices, offsets, count }
        initialStreamState[streamName] = polyPayload
      } catch {
        // skip malformed polygon entries
      }
    }
  }

  return { metadata, initialStreamState, staticImageUrls }
}
