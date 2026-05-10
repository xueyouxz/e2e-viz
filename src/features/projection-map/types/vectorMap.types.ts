export type SplitName = 'train' | 'val'

export type ProjectionScene = {
  scene_name: string
  scene_token: string
  tsne_comp1: number
  tsne_comp2: number
  som_comp1?: number
  som_comp2?: number
}

export type ProjectionPayload = {
  scene_counts: number
  scenes: ProjectionScene[]
}

export type SceneObjectSummary = {
  split: SplitName
  scene_token: string
  scene_name: string
  scene_description: string
  map_name: string
  map_filename: string
  location: string
  nbr_samples: number
  object_total_unique: number
  object_counts_by_category: Record<string, number>
}

export type SceneObjectSummaryPayload = {
  version: string
  dataroot: string
  summary: {
    total_scenes: number
    splits: Record<SplitName, number>
    missing_scenes: Record<string, unknown>
  }
  scenes: SceneObjectSummary[]
}

export type VectorMapManifest = {
  generatedFrom: string
  splits: Record<SplitName, string[]>
}

export type Point2D = [number, number]

export type PolygonGeometry = {
  type: 'Polygon'
  coordinates: Point2D[][]
}

export type LineStringGeometry = {
  type: 'LineString'
  coordinates: Point2D[]
}

export type VectorMapScene = {
  map_location: string
  layers: {
    drivable_area: PolygonGeometry[]
    ped_crossing: PolygonGeometry[]
    divider: LineStringGeometry[]
  }
}

export type VectorMapPayload = Record<string, VectorMapScene>

export type ProjectionMapPoint = ProjectionScene & {
  split: SplitName
  summary?: SceneObjectSummary
}
