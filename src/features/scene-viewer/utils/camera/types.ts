export interface ProjectedPoint2D {
  u: number
  v: number
  depth: number
}

export interface ProjectedBox3DWireframe {
  trackId: number
  classId: number
  color: string
  strokeOpacity: number
  depth: number
  points: Array<ProjectedPoint2D | null>
}

// NUSVIZ protocol-defined camera channel identifiers.
export const CAMERA_CHANNELS = [
  'CAM_FRONT',
  'CAM_FRONT_LEFT',
  'CAM_FRONT_RIGHT',
  'CAM_BACK',
  'CAM_BACK_LEFT',
  'CAM_BACK_RIGHT'
] as const satisfies string[]

export type CameraChannel = (typeof CAMERA_CHANNELS)[number]

export type ChannelProjectedBoxes = Record<string, ProjectedBox3DWireframe[]>

export type OverlayFitMode = 'cover' | 'contain'
