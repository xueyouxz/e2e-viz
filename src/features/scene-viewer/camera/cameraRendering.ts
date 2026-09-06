import type { ProjectedCuboid, ProjectedImagePoint } from './cameraProjection'

export type ImageFitMode = 'cover' | 'contain'

export interface CameraViewportTransform {
  scale: number
  offsetX: number
  offsetY: number
  viewportWidth: number
  viewportHeight: number
  sourceWidth: number
  sourceHeight: number
}

export interface CanvasRenderScratch {
  hiddenEdgeDash: number[]
}

export function createCanvasRenderScratch(): CanvasRenderScratch {
  return { hiddenEdgeDash: [0, 0] }
}

// Rendering and pointer picking share this image-to-viewport transform.
export function computeViewportTransform(
  viewportWidth: number,
  viewportHeight: number,
  sourceWidth: number,
  sourceHeight: number,
  fitMode: ImageFitMode
): CameraViewportTransform {
  if (viewportWidth <= 0 || viewportHeight <= 0 || sourceWidth <= 0 || sourceHeight <= 0) {
    return {
      scale: 1,
      offsetX: 0,
      offsetY: 0,
      viewportWidth,
      viewportHeight,
      sourceWidth,
      sourceHeight
    }
  }

  const scale =
    fitMode === 'cover'
      ? Math.max(viewportWidth / sourceWidth, viewportHeight / sourceHeight)
      : Math.min(viewportWidth / sourceWidth, viewportHeight / sourceHeight)
  return {
    scale,
    offsetX: (viewportWidth - sourceWidth * scale) / 2,
    offsetY: (viewportHeight - sourceHeight * scale) / 2,
    viewportWidth,
    viewportHeight,
    sourceWidth,
    sourceHeight
  }
}

export function pickTrackAtViewportPoint(
  viewportX: number,
  viewportY: number,
  projectedCuboids: ProjectedCuboid[],
  transform: CameraViewportTransform,
  margin = 12
): number | null {
  const imageX = (viewportX - transform.offsetX) / transform.scale
  const imageY = (viewportY - transform.offsetY) / transform.scale
  let selectedTrackId: number | null = null
  let smallestArea = Infinity

  for (const cuboid of projectedCuboids) {
    const { minU, maxU, minV, maxV } = cuboid.bounds
    if (
      imageX < minU - margin ||
      imageX > maxU + margin ||
      imageY < minV - margin ||
      imageY > maxV + margin
    ) {
      continue
    }
    const area = (maxU - minU) * (maxV - minV)
    if (area < smallestArea) {
      smallestArea = area
      selectedTrackId = cuboid.trackId
    }
  }
  return selectedTrackId
}

type FaceIndices = [number, number, number, number]
type EdgePair = [number, number]

// Corner order matches cameraProjection.ts: 0..3 use local z=-0.5 and 4..7 use z=+0.5.
const CUBOID_FACES: FaceIndices[] = [
  [0, 1, 2, 3],
  [4, 7, 6, 5],
  [0, 4, 5, 1],
  [2, 6, 7, 3],
  [3, 7, 4, 0],
  [1, 5, 6, 2]
]

const CUBOID_EDGES: EdgePair[] = [
  [0, 1],
  [1, 2],
  [2, 3],
  [3, 0],
  [4, 5],
  [5, 6],
  [6, 7],
  [7, 4],
  [0, 4],
  [1, 5],
  [2, 6],
  [3, 7]
]

const FACE_EDGES: FaceIndices[] = [
  [0, 1, 2, 3],
  [7, 6, 5, 4],
  [8, 4, 9, 0],
  [10, 6, 11, 2],
  [11, 7, 8, 3],
  [9, 5, 10, 1]
]

const HIDDEN_EDGE_DASH = [6, 4]
const DEFAULT_CULL_MARGIN = 24

interface CuboidRenderOptions {
  near?: number
  far?: number
  clipMinU?: number
  clipMaxU?: number
  clipMinV?: number
  clipMaxV?: number
  cullMargin?: number
  displayScale?: number
  selectedTrackId?: number | null
}

function isFaceVisible(points: Array<ProjectedImagePoint | null>, face: FaceIndices): boolean {
  const [a, b, c, d] = face
  const pointA = points[a]
  const pointB = points[b]
  const pointC = points[c]
  const pointD = points[d]
  if (!pointA || !pointB || !pointC || !pointD) return false

  const crossProduct =
    (pointB.u - pointA.u) * (pointC.v - pointA.v) -
    (pointB.v - pointA.v) * (pointC.u - pointA.u) +
    (pointD.u - pointC.u) * (pointA.v - pointC.v) -
    (pointD.v - pointC.v) * (pointA.u - pointC.u)

  return crossProduct > 0
}

function isOutsideClipBounds(
  points: Array<ProjectedImagePoint | null>,
  clipMinU: number,
  clipMaxU: number,
  clipMinV: number,
  clipMaxV: number,
  margin: number
): boolean {
  let hasPoint = false
  let minU = Infinity
  let maxU = -Infinity
  let minV = Infinity
  let maxV = -Infinity

  for (const point of points) {
    if (!point) continue
    hasPoint = true
    if (point.u < minU) minU = point.u
    if (point.u > maxU) maxU = point.u
    if (point.v < minV) minV = point.v
    if (point.v > maxV) maxV = point.v
  }

  if (!hasPoint) return true
  return (
    maxU < clipMinU - margin ||
    minU > clipMaxU + margin ||
    maxV < clipMinV - margin ||
    minV > clipMaxV + margin
  )
}

function computeLineWidth(
  depth: number,
  near: number,
  far: number,
  maximum: number,
  minimum: number
): number {
  const depthRatio = Math.min(Math.max((depth - near) / (far - near), 0), 1)
  return maximum - depthRatio * (maximum - minimum)
}

function getVisibleEdgeMask(points: Array<ProjectedImagePoint | null>): number {
  let mask = 0
  for (let faceIndex = 0; faceIndex < CUBOID_FACES.length; faceIndex++) {
    if (!isFaceVisible(points, CUBOID_FACES[faceIndex])) continue
    const edges = FACE_EDGES[faceIndex]
    mask |= (1 << edges[0]) | (1 << edges[1]) | (1 << edges[2]) | (1 << edges[3])
  }
  return mask
}

function strokeEdges(
  context: CanvasRenderingContext2D,
  points: Array<ProjectedImagePoint | null>,
  visibleEdgeMask: number,
  drawVisibleEdges: boolean
): void {
  context.beginPath()
  for (let edgeIndex = 0; edgeIndex < CUBOID_EDGES.length; edgeIndex++) {
    const isVisibleEdge = (visibleEdgeMask & (1 << edgeIndex)) !== 0
    if (isVisibleEdge !== drawVisibleEdges) continue
    const [startIndex, endIndex] = CUBOID_EDGES[edgeIndex]
    const start = points[startIndex]
    const end = points[endIndex]
    if (!start || !end) continue
    context.moveTo(start.u, start.v)
    context.lineTo(end.u, end.v)
  }
  context.stroke()
}

function drawCuboid(
  context: CanvasRenderingContext2D,
  cuboid: ProjectedCuboid,
  options: Required<Pick<CuboidRenderOptions, 'near' | 'far' | 'cullMargin' | 'displayScale'>> &
    Pick<CuboidRenderOptions, 'clipMinU' | 'clipMaxU' | 'clipMinV' | 'clipMaxV'>,
  isSelected: boolean,
  scratch: CanvasRenderScratch
): void {
  if (
    options.clipMinU !== undefined &&
    options.clipMaxU !== undefined &&
    options.clipMinV !== undefined &&
    options.clipMaxV !== undefined &&
    isOutsideClipBounds(
      cuboid.points,
      options.clipMinU,
      options.clipMaxU,
      options.clipMinV,
      options.clipMaxV,
      options.cullMargin
    )
  ) {
    return
  }

  const baseLineWidth = computeLineWidth(cuboid.depth, options.near, options.far, 1.5, 0.5)
  const lineWidth = isSelected ? baseLineWidth * 2.5 : baseLineWidth
  const visibleEdgeMask = getVisibleEdgeMask(cuboid.points)
  const { color, strokeOpacity } = cuboid

  context.save()
  context.lineJoin = 'round'
  context.lineCap = 'round'

  if (isSelected) {
    context.lineWidth = (lineWidth * 1.8) / options.displayScale
    context.strokeStyle = `${color}55`
    context.setLineDash([])
    strokeEdges(context, cuboid.points, 0xfff, true)
    strokeEdges(context, cuboid.points, 0xfff, false)

    context.lineWidth = lineWidth / options.displayScale
    context.strokeStyle = '#ffffff'
    context.setLineDash([])
    strokeEdges(context, cuboid.points, 0xfff, true)
    strokeEdges(context, cuboid.points, 0xfff, false)
  } else {
    const visibleStroke = `${color}${Math.round(strokeOpacity * 255)
      .toString(16)
      .padStart(2, '0')}`
    const hiddenOpacity = Math.max(strokeOpacity * 0.55, 0.2)
    const hiddenStroke = `${color}${Math.round(hiddenOpacity * 255)
      .toString(16)
      .padStart(2, '0')}`

    context.lineWidth = lineWidth / options.displayScale
    context.strokeStyle = visibleStroke
    context.setLineDash([])
    strokeEdges(context, cuboid.points, visibleEdgeMask, true)

    context.strokeStyle = hiddenStroke
    scratch.hiddenEdgeDash[0] = HIDDEN_EDGE_DASH[0] / options.displayScale
    scratch.hiddenEdgeDash[1] = HIDDEN_EDGE_DASH[1] / options.displayScale
    context.setLineDash(scratch.hiddenEdgeDash)
    strokeEdges(context, cuboid.points, visibleEdgeMask, false)
    context.setLineDash([])
  }

  context.restore()
}

export function drawCuboidWireframes(
  context: CanvasRenderingContext2D,
  projectedCuboids: ProjectedCuboid[],
  options: CuboidRenderOptions = {},
  scratch: CanvasRenderScratch = createCanvasRenderScratch()
): void {
  const renderOptions = {
    near: options.near ?? 1,
    far: options.far ?? 80,
    cullMargin: options.cullMargin ?? DEFAULT_CULL_MARGIN,
    displayScale: options.displayScale ?? 1,
    clipMinU: options.clipMinU,
    clipMaxU: options.clipMaxU,
    clipMinV: options.clipMinV,
    clipMaxV: options.clipMaxV
  }
  const selectedTrackId = options.selectedTrackId ?? null

  for (const cuboid of projectedCuboids) {
    if (cuboid.trackId === selectedTrackId) continue
    drawCuboid(context, cuboid, renderOptions, false, scratch)
  }
  for (const cuboid of projectedCuboids) {
    if (cuboid.trackId !== selectedTrackId) continue
    drawCuboid(context, cuboid, renderOptions, true, scratch)
  }
}

export function renderProjectedCuboids(
  canvas: HTMLCanvasElement,
  projectedCuboids: ProjectedCuboid[],
  transform: CameraViewportTransform,
  selectedTrackId: number | null,
  scratch: CanvasRenderScratch,
  devicePixelRatio: number
): void {
  const width = transform.viewportWidth
  const height = transform.viewportHeight
  if (width <= 0 || height <= 0) return

  const pixelRatio = Math.max(1, devicePixelRatio)
  const pixelWidth = Math.max(1, Math.floor(width * pixelRatio))
  const pixelHeight = Math.max(1, Math.floor(height * pixelRatio))
  if (canvas.width !== pixelWidth) canvas.width = pixelWidth
  if (canvas.height !== pixelHeight) canvas.height = pixelHeight

  const context = canvas.getContext('2d')
  if (!context) return
  context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0)
  context.clearRect(0, 0, width, height)
  context.save()
  context.translate(transform.offsetX, transform.offsetY)
  context.scale(transform.scale, transform.scale)
  drawCuboidWireframes(
    context,
    projectedCuboids,
    {
      clipMinU: -transform.offsetX / transform.scale,
      clipMaxU: (width - transform.offsetX) / transform.scale,
      clipMinV: -transform.offsetY / transform.scale,
      clipMaxV: (height - transform.offsetY) / transform.scale,
      cullMargin: DEFAULT_CULL_MARGIN / transform.scale,
      displayScale: transform.scale,
      selectedTrackId
    },
    scratch
  )
  context.restore()
}
