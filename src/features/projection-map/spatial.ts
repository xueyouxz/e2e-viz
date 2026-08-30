import * as d3 from 'd3'
import type { ProjectionMapPoint } from './types'

export const VIEWBOX_WIDTH = 1280
export const VIEWBOX_HEIGHT = 760

const CELL_SIZE = 80
const FIT_PADDING = 72
const SNAP_LEVELS: readonly number[] = Array.from({ length: 21 }, (_, index) =>
  Math.pow(2, (index - 4) / 4)
)

export type Vec2 = [number, number]

export type Viewport = {
  k: number
  tx: number
  ty: number
}

export type ScalePair = {
  x: d3.ScaleLinear<number, number>
  y: d3.ScaleLinear<number, number>
}

export type GridIndex = Map<number, Map<string, ProjectionMapPoint>>

export function pointInPolygon(px: number, py: number, polygon: Vec2[]): boolean {
  let inside = false
  for (let index = 0, previous = polygon.length - 1; index < polygon.length; previous = index++) {
    const [x, y] = polygon[index]
    const [previousX, previousY] = polygon[previous]
    if (y > py !== previousY > py && px < ((previousX - x) * (py - y)) / (previousY - y) + x) {
      inside = !inside
    }
  }
  return inside
}

export function polygonPath(polygon: Vec2[]): string {
  if (polygon.length < 2) return ''
  return (
    polygon
      .map(
        (point, index) => `${index === 0 ? 'M' : 'L'}${point[0].toFixed(1)},${point[1].toFixed(1)}`
      )
      .join('') + 'Z'
  )
}

export function computeFitTransform(
  points: ProjectionMapPoint[],
  scales: ScalePair
): d3.ZoomTransform {
  const xs = points.map(point => scales.x(point.tsne_comp1))
  const ys = points.map(point => scales.y(point.tsne_comp2))
  const x0 = Math.min(...xs)
  const x1 = Math.max(...xs)
  const y0 = Math.min(...ys)
  const y1 = Math.max(...ys)
  const width = Math.max(x1 - x0, 1) + FIT_PADDING * 2
  const height = Math.max(y1 - y0, 1) + FIT_PADDING * 2
  const scale = Math.min(VIEWBOX_WIDTH / width, VIEWBOX_HEIGHT / height, 8)
  const centerX = (x0 + x1) / 2
  const centerY = (y0 + y1) / 2
  return d3.zoomIdentity
    .translate(VIEWBOX_WIDTH / 2 - centerX * scale, VIEWBOX_HEIGHT / 2 - centerY * scale)
    .scale(scale)
}

export function reprojectPolygon(
  dataPolygon: Vec2[],
  scales: ScalePair,
  transform: d3.ZoomTransform
): Vec2[] {
  return dataPolygon.map(
    ([x, y]): Vec2 => [
      scales.x(x) * transform.k + transform.x,
      scales.y(y) * transform.k + transform.y
    ]
  )
}

export function snapGridScale(scale: number): number {
  return Math.pow(2, Math.round(Math.log2(scale) * 4) / 4)
}

export function buildGridIndex(points: ProjectionMapPoint[], scales: ScalePair): GridIndex {
  const index: GridIndex = new Map()
  for (const scale of SNAP_LEVELS) index.set(scale, computeGridCells(points, scales, scale))
  return index
}

function computeGridCells(
  points: ProjectionMapPoint[],
  scales: ScalePair,
  scale: number
): Map<string, ProjectionMapPoint> {
  const closestByCell = new Map<string, { point: ProjectionMapPoint; distanceSquared: number }>()
  for (const point of points) {
    const x = scales.x(point.tsne_comp1) * scale
    const y = scales.y(point.tsne_comp2) * scale
    const column = Math.floor(x / CELL_SIZE)
    const row = Math.floor(y / CELL_SIZE)
    const key = `${column},${row}`
    const distanceSquared =
      (x - (column + 0.5) * CELL_SIZE) ** 2 + (y - (row + 0.5) * CELL_SIZE) ** 2
    const current = closestByCell.get(key)
    if (!current || distanceSquared < current.distanceSquared) {
      closestByCell.set(key, { point, distanceSquared })
    }
  }

  return new Map(
    [...closestByCell].map(([key, { point }]) => [key, point] as [string, ProjectionMapPoint])
  )
}
