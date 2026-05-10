export type StreamType = 'pose' | 'point' | 'polyline' | 'polygon' | 'cuboid' | 'image'

export interface StreamMeta {
  type: StreamType
  coordinate: 'world' | 'ego'
  category: string
}

export interface EgoPose {
  translation: [number, number, number]
  rotation: [number, number, number, number] // [w, x, y, z]
}

export interface CameraInfo {
  image_width: number
  image_height: number
  intrinsic: [[number, number, number], [number, number, number], [number, number, number]]
  extrinsic: {
    translation: [number, number, number]
    rotation: [number, number, number, number]
  }
}

export interface ImageBounds {
  min_x: number
  min_y: number
  max_x: number
  max_y: number
}

// ─── StreamPayload: typed array format stored in the Zustand store ────────────

export interface PointPayload {
  type: 'point'
  points: Float32Array
  intensity: Float32Array | null
}

export interface PolylinePayload {
  type: 'polyline'
  vertices: Float32Array
  offsets: Uint32Array
  count: number
}

export interface PolygonPayload {
  type: 'polygon'
  vertices: Float32Array
  offsets: Uint32Array
  count: number
}

export interface CuboidPayload {
  type: 'cuboid'
  centers: Float32Array
  sizes: Float32Array
  rotations: Float32Array
  classIds: Uint32Array
  trackIds: Uint32Array | null
  scores: Float32Array | null
  count: number
}

export interface ImagePayload {
  type: 'image'
  url: string // Blob URL — created on main thread
  width: number
  height: number
  bounds?: ImageBounds
}

export type StreamPayload =
  | PointPayload
  | PolylinePayload
  | PolygonPayload
  | CuboidPayload
  | ImagePayload

// ─── Raw decoded frame from Worker (before main-thread materialisation) ────────

// path type is now disambiguated in the worker — 'polyline' or 'polygon' directly
export type RawStreamPayload =
  | { _raw: 'point'; points: Float32Array; intensity: Float32Array | null }
  | { _raw: 'polyline'; vertices: Float32Array; offsets: Uint32Array; count: number }
  | { _raw: 'polygon'; vertices: Float32Array; offsets: Uint32Array; count: number }
  | { _raw: 'cuboid'; centers: Float32Array; sizes: Float32Array; rotations: Float32Array; classIds: Uint32Array; trackIds: Uint32Array | null; scores: Float32Array | null; count: number }
  | { _raw: 'image'; bytes: ArrayBuffer; mimeType: string; width: number; height: number; bounds?: ImageBounds }

export interface RawDecodedFrame {
  updateType: 'COMPLETE_STATE' | 'INCREMENTAL'
  timestamp: number
  egoPose: EgoPose | null
  patches: Record<string, RawStreamPayload>
}

// ─── Style ───────────────────────────────────────────────────────────────────

/** Context passed to styleFn on every frame. */
export interface FrameStyleContext {
  frameIndex: number
  metrics: Record<string, Float32Array> | null
}

export interface StyleConfig {
  color?: string
  outlineColor?: string
  opacity?: number
  lineWidth?: number
  outlineWidth?: number
  renderOrder?: number
  /** Per-frame style override — return any subset of StyleConfig fields. */
  styleFn?: (ctx: FrameStyleContext) => Partial<Omit<StyleConfig, 'styleFn'>>
}

// ─── Renderer interface ───────────────────────────────────────────────────────

export interface LayerRendererProps {
  streamName: string
  style: StyleConfig
}

// ─── Metadata ────────────────────────────────────────────────────────────────

export interface MessageEntry {
  index: number
  timestamp: number
  file: string
}

export interface MessageIndex {
  message_format: string
  metadata: string
  log_info: {
    start_time: number
    end_time: number
  }
  messages: MessageEntry[]
}

export interface ObjectCountSeries {
  total: Float32Array
  categories: Record<string, Float32Array>
}

export interface SceneStatistics {
  frameCount: number
  egoSpeed: Float32Array | null
  egoAcceleration: Float32Array | null
  objectCounts: Record<string, ObjectCountSeries>
  metrics: Record<string, Float32Array>
}

export interface SceneMetadata {
  streams: Record<string, StreamMeta>
  cameras: Record<string, CameraInfo>
  totalFrames: number
  logInfo: {
    start_time: number
    end_time: number
  }
  timestamps: Float32Array | null
  statistics: SceneStatistics | null
  sceneName: string
  sceneDescription: string
}
