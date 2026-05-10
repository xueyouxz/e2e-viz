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

export type ChannelProjectedBoxes = Record<string, ProjectedBox3DWireframe[]>

export type OverlayFitMode = 'cover' | 'contain'
