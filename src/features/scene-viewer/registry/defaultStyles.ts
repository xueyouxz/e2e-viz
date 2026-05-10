import type { StyleConfig } from '../types'

// Render order hierarchy (higher = renders later / appears on top):
//   -20  basemap image          (always below everything)
//   -10  gt map polygon fills   (below dynamic 3D data)
//    0   point cloud            (lidar, real 3D heights)
//    1   pred map polylines     (above basemap/polygons)
//    2   cuboid fills           (3D objects)
//    5   trajectories / paths   (above map, below cuboid edges)
//   12   cuboid edges           (CuboidLayer adds +10 automatically)

function lerpColor(hexA: string, hexB: string, t: number): string {
  const ar = parseInt(hexA.slice(1, 3), 16)
  const ag = parseInt(hexA.slice(3, 5), 16)
  const ab = parseInt(hexA.slice(5, 7), 16)
  const br = parseInt(hexB.slice(1, 3), 16)
  const bg = parseInt(hexB.slice(3, 5), 16)
  const bb = parseInt(hexB.slice(5, 7), 16)
  const r = Math.round(ar + (br - ar) * t).toString(16).padStart(2, '0')
  const g = Math.round(ag + (bg - ag) * t).toString(16).padStart(2, '0')
  const b = Math.round(ab + (bb - ab) * t).toString(16).padStart(2, '0')
  return `#${r}${g}${b}`
}

export const defaultStyles: Record<string, StyleConfig> = {
  '/lidar': { color: '#ffffff', opacity: 0.8, renderOrder: 0 },

  '/gt/objects/bounds':              { color: '#4b8cf8', opacity: 0.75, renderOrder: 2 },
  '/gt/objects/future_trajectories': { color: '#4b8cf8', opacity: 0.7, lineWidth: 0.3, renderOrder: 5 },
  '/gt/ego/future_trajectory':       { color: '#00e5ff', opacity: 0.9, lineWidth: 1, renderOrder: 5 },

  '/pred/sparsedrive/planning': {
    opacity: 0.9,
    lineWidth: 1,
    renderOrder: 5,
    // planning L2 error 0 m → green, 3 m → red, linear interpolation
    styleFn: ({ frameIndex, metrics }) => {
      const l2 = metrics?.['planning']?.[frameIndex]
      if (l2 == null) return { color: '#00e676' }
      const t = Math.max(0, Math.min(1, l2 / 3.0))
      return { color: lerpColor('#00e676', '#ff1744', t) }
    },
  },
  '/pred/sparsedrive/objects/bounds':   { color: '#f8a94b', opacity: 0.35, renderOrder: 2 },
  '/pred/sparsedrive/map/divider':      { color: '#ffcc00', opacity: 0.8, lineWidth: 0.1, renderOrder: 1 },
  '/pred/sparsedrive/map/boundary':     { color: '#ff7043', opacity: 0.8, lineWidth: 0.1, renderOrder: 1 },
  '/pred/sparsedrive/map/ped_crossing': { color: '#ce93d8', opacity: 0.8, lineWidth: 0.1, renderOrder: 1 },

  '/gt/map/drivable_area':  { color: '#ffffff', opacity: 0.25, outlineColor: '#c8d0d8', outlineWidth: 2.5, renderOrder: -10 },
  '/gt/map/road_segment':   { color: '#505ec9', opacity: 0.1,  renderOrder: -10 },
  '/gt/map/lane':           { color: '#7e8bdd', opacity: 0.1,  renderOrder: -10 },
  '/gt/map/lane_connector': { color: '#8891d8', outlineColor: '#bdc3f5', opacity: 0.07, outlineWidth: 0.7, renderOrder: -10 },
  '/gt/map/ped_crossing':   { color: '#7986cb', opacity: 0.2,  renderOrder: -10 },
  '/gt/map/walkway':        { color: '#9fa8da', opacity: 0.1,  renderOrder: -10 },
  '/gt/map/stop_line':      { color: '#ef9a9a', opacity: 0.1,  renderOrder: -10 },
  '/gt/map/carpark_area':   { color: '#bcaaa4', opacity: 0.1,  renderOrder: -10 },

  '/map/basemap': { opacity: 0.8, renderOrder: -20 },
}

export function getStyle(streamName: string): StyleConfig {
  return defaultStyles[streamName] ?? {}
}
