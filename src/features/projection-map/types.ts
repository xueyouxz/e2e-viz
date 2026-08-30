export type SplitName = 'train' | 'val'

export type ProjectionMapPoint = {
  scene_name: string
  scene_token: string
  split: SplitName
  tsne_comp1: number
  tsne_comp2: number
  som_comp1?: number
  som_comp2?: number
}
