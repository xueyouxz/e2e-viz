/** World-space 3D coordinate [x, y, z] */
export type Vec3 = [number, number, number]

/** wxyz quaternion convention (nuScenes / ROS) */
export type QuatWXYZ = [number, number, number, number]

// ─── Layer datum types ──────────────────────────────────────────────────────

export interface PointLayerDatum {
  position: Vec3
  /** Per-point colour override; falls back to layer-level `color` */
  color?: string
}

export interface PolygonLayerDatum {
  /** Closed ring — last vertex is auto-connected back to first */
  vertices: Vec3[]
  /** Per-polygon colour override */
  color?: string
}

export interface CuboidLayerDatum {
  center: Vec3
  /** [width, length, height] — nuScenes wlh convention */
  size: Vec3
  /** wxyz quaternion; identity assumed if omitted */
  rotation?: QuatWXYZ
  /** Per-cuboid colour override */
  color?: string
}

export interface ImageLayerDatum {
  /** URL served from `public/` or a fully-qualified URL */
  url: string
  /** Center position in world space */
  center: Vec3
  /** Width in world units (local X axis) */
  width: number
  /** Height in world units (local Y axis) */
  height: number
  /** wxyz quaternion; identity assumed if omitted */
  rotation?: QuatWXYZ
}

export interface PathLayerDatum {
  positions: Vec3[]
  /** Per-path colour override */
  color?: string
  /** Line width in pixels; falls back to PathLayerProps.lineWidth */
  width?: number
}

// ─── Shared layer props ──────────────────────────────────────────────────────

export interface LayerBaseProps {
  visible?: boolean
  renderOrder?: number
  opacity?: number
}
