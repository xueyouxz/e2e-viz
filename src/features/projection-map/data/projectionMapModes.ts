import type { SplitName } from '../types/vectorMap.types'

export type MapDisplayMode = 'scatter' | 'density' | 'val' | 'train' | 'all'

export const MODES: { id: MapDisplayMode; label: string; splits: SplitName[] }[] = [
  { id: 'val', label: 'Validation', splits: ['val'] },
  { id: 'train', label: 'Training', splits: ['train'] },
  { id: 'all', label: 'All', splits: ['train', 'val'] },
]
