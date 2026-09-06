import * as d3 from 'd3'
import type { ProjectionMapPoint } from './types'
import {
  GLYPH_GRID_SIZE,
  GLYPH_GRID_SCALES,
  ZOOM_EXTENT,
  resolveGlyphLayout
} from './glyph/glyphLayout'

export const VIEWBOX_WIDTH = 1280
export const VIEWBOX_HEIGHT = 760

export type ViewBoxBounds = { x: number; y: number; width: number; height: number }

// Include the root SVG's xMidYMid meet letterboxing in its visible user coordinates.
export function viewBoxBounds(width: number, height: number): ViewBoxBounds {
  const scale = Math.min(width / VIEWBOX_WIDTH, height / VIEWBOX_HEIGHT)
  const visibleWidth = width / scale
  const visibleHeight = height / scale
  return {
    x: (VIEWBOX_WIDTH - visibleWidth) / 2,
    y: (VIEWBOX_HEIGHT - visibleHeight) / 2,
    width: visibleWidth,
    height: visibleHeight
  }
}

const FIT_PADDING = 72

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

type ProjectedGridPoint = {
  point: ProjectionMapPoint
  x: number
  y: number
}

type GridCell = ProjectedGridPoint & {
  distanceSquared: number
}

type GridLevel = Map<number, Map<number, GridCell>>

export type GridIndex = Map<number, GridLevel>

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
  if (points.length === 0) return d3.zoomIdentity
  const xs = points.map(point => scales.x(point.tsne_comp1))
  const ys = points.map(point => scales.y(point.tsne_comp2))
  const x0 = Math.min(...xs)
  const x1 = Math.max(...xs)
  const y0 = Math.min(...ys)
  const y1 = Math.max(...ys)
  const width = Math.max(x1 - x0, 1) + FIT_PADDING * 2
  const height = Math.max(y1 - y0, 1) + FIT_PADDING * 2
  const scale = Math.max(
    ZOOM_EXTENT[0],
    Math.min(VIEWBOX_WIDTH / width, VIEWBOX_HEIGHT / height, 8)
  )
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

export function buildGridIndex(points: ProjectionMapPoint[], scales: ScalePair): GridIndex {
  const index: GridIndex = new Map()
  const projectedPoints = points.map<ProjectedGridPoint>(point => ({
    point,
    x: scales.x(point.tsne_comp1),
    y: scales.y(point.tsne_comp2)
  }))
  for (const scale of GLYPH_GRID_SCALES) index.set(scale, computeGridLevel(projectedPoints, scale))
  return index
}

export function queryVisibleGridPoints(
  indexes: readonly GridIndex[],
  viewport: Viewport,
  bounds: ViewBoxBounds,
  layout = resolveGlyphLayout(viewport.k)
): ProjectedGridPoint[] {
  const { k, tx, ty } = viewport
  if (k <= 0 || !Number.isFinite(k)) return []

  const { gridScale: scale, cullingPadding: padding } = layout
  const levels = indexes.flatMap(index => {
    const level = index.get(scale)
    return level ? [level] : []
  })
  if (levels.length === 0) return []

  const left = bounds.x - padding
  const right = bounds.x + bounds.width + padding
  const top = bounds.y - padding
  const bottom = bounds.y + bounds.height + padding
  const firstColumn = Math.floor((((left - tx) / k) * scale) / GLYPH_GRID_SIZE)
  const lastColumn = Math.floor((((right - tx) / k) * scale) / GLYPH_GRID_SIZE)
  const firstRow = Math.floor((((top - ty) / k) * scale) / GLYPH_GRID_SIZE)
  const lastRow = Math.floor((((bottom - ty) / k) * scale) / GLYPH_GRID_SIZE)
  const visible: ProjectedGridPoint[] = []

  for (let row = firstRow; row <= lastRow; row += 1) {
    for (let column = firstColumn; column <= lastColumn; column += 1) {
      let candidate: GridCell | undefined
      for (const level of levels) {
        const next = level.get(row)?.get(column)
        if (next && isBetterCandidate(next, candidate)) candidate = next
      }
      if (!candidate) continue

      const screenX = candidate.x * k + tx
      const screenY = candidate.y * k + ty
      if (screenX >= left && screenX <= right && screenY >= top && screenY <= bottom) {
        visible.push(candidate)
      }
    }
  }

  return visible
}

function computeGridLevel(points: ProjectedGridPoint[], scale: number): GridLevel {
  const rows: GridLevel = new Map()
  for (const projectedPoint of points) {
    const scaledX = projectedPoint.x * scale
    const scaledY = projectedPoint.y * scale
    const column = Math.floor(scaledX / GLYPH_GRID_SIZE)
    const row = Math.floor(scaledY / GLYPH_GRID_SIZE)
    const distanceSquared =
      (scaledX - (column + 0.5) * GLYPH_GRID_SIZE) ** 2 +
      (scaledY - (row + 0.5) * GLYPH_GRID_SIZE) ** 2
    let cells = rows.get(row)
    if (!cells) {
      cells = new Map()
      rows.set(row, cells)
    }
    const current = cells.get(column)
    const candidate = { ...projectedPoint, distanceSquared }
    if (isBetterCandidate(candidate, current)) cells.set(column, candidate)
  }
  return rows
}

// The representative must not depend on split order or source array order.
function isBetterCandidate(next: GridCell, current?: GridCell): boolean {
  return (
    !current ||
    next.distanceSquared < current.distanceSquared ||
    (next.distanceSquared === current.distanceSquared &&
      next.point.scene_name < current.point.scene_name)
  )
}

export function selectPointsInPolygon(
  points: ProjectionMapPoint[],
  polygon: Vec2[]
): ProjectionMapPoint[] {
  return points.filter(point => pointInPolygon(point.tsne_comp1, point.tsne_comp2, polygon))
}

export function toDataPolygon(
  polygon: Vec2[],
  scales: ScalePair,
  transform: d3.ZoomTransform
): Vec2[] {
  return polygon.map(([x, y]) => [
    scales.x.invert((x - transform.x) / transform.k),
    scales.y.invert((y - transform.y) / transform.k)
  ])
}

export function toViewBox(svg: SVGSVGElement, clientX: number, clientY: number): Vec2 {
  const ctm = svg.getScreenCTM()
  if (ctm && typeof DOMPoint !== 'undefined') {
    const point = new DOMPoint(clientX, clientY).matrixTransform(ctm.inverse())
    return [point.x, point.y]
  }
  // Match the root SVG's default xMidYMid meet, including letterboxing.
  const rect = svg.getBoundingClientRect()
  const scale = Math.min(rect.width / VIEWBOX_WIDTH, rect.height / VIEWBOX_HEIGHT)
  return [
    (clientX - rect.left - (rect.width - VIEWBOX_WIDTH * scale) / 2) / scale,
    (clientY - rect.top - (rect.height - VIEWBOX_HEIGHT * scale) / 2) / scale
  ]
}
