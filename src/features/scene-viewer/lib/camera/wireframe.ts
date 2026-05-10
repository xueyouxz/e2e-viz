import type { ProjectedBox3DWireframe, ProjectedPoint2D } from './types'

type FaceIndices = [number, number, number, number]
type EdgePair = [number, number]
type FaceEdgeIndices = [number, number, number, number]

// Corner order matches projection.ts LOCAL_BOX_CORNERS: indices 0..3 are local z=-0.5, 4..7 are z=+0.5.
const BOX_FACE_INDICES: FaceIndices[] = [
  [0, 1, 2, 3],
  [4, 7, 6, 5],
  [0, 4, 5, 1],
  [2, 6, 7, 3],
  [3, 7, 4, 0],
  [1, 5, 6, 2],
]

const BOX_EDGE_PAIRS: EdgePair[] = [
  [0, 1], [1, 2], [2, 3], [3, 0],
  [4, 5], [5, 6], [6, 7], [7, 4],
  [0, 4], [1, 5], [2, 6], [3, 7],
]

const BOX_FACE_EDGE_INDICES: FaceEdgeIndices[] = [
  [0, 1, 2, 3],
  [7, 6, 5, 4],
  [8, 4, 9, 0],
  [10, 6, 11, 2],
  [11, 7, 8, 3],
  [9, 5, 10, 1],
]

const HIDDEN_EDGE_DASH = [6, 4]
const DEFAULT_CULL_MARGIN_PX = 24
const _scaledHiddenEdgeDash = [0, 0]

interface WireframeDrawOptions {
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

function isFaceVisible(points: Array<ProjectedPoint2D | null>, face: FaceIndices): boolean {
  const [a, b, c, d] = face
  const pa = points[a], pb = points[b], pc = points[c], pd = points[d]
  if (!pa || !pb || !pc || !pd) return false

  const cross =
    (pb.u - pa.u) * (pc.v - pa.v) -
    (pb.v - pa.v) * (pc.u - pa.u) +
    (pd.u - pc.u) * (pa.v - pc.v) -
    (pd.v - pc.v) * (pa.u - pc.u)

  return cross > 0
}

function isBoxOutsideClip(
  points: Array<ProjectedPoint2D | null>,
  clipMinU: number, clipMaxU: number,
  clipMinV: number, clipMaxV: number,
  margin: number,
): boolean {
  let hasPoint = false
  let minU = Infinity, maxU = -Infinity, minV = Infinity, maxV = -Infinity

  for (const p of points) {
    if (!p) continue
    hasPoint = true
    if (p.u < minU) minU = p.u
    if (p.u > maxU) maxU = p.u
    if (p.v < minV) minV = p.v
    if (p.v > maxV) maxV = p.v
  }

  if (!hasPoint) return true
  return maxU < clipMinU - margin || minU > clipMaxU + margin ||
         maxV < clipMinV - margin || minV > clipMaxV + margin
}

function computeLineWidth(depth: number, near: number, far: number, maxW: number, minW: number): number {
  const t = Math.min(Math.max((depth - near) / (far - near), 0), 1)
  return maxW - t * (maxW - minW)
}

function getVisibleEdgeMask(points: Array<ProjectedPoint2D | null>): number {
  let mask = 0
  for (let f = 0; f < BOX_FACE_INDICES.length; f++) {
    if (!isFaceVisible(points, BOX_FACE_INDICES[f])) continue
    const fe = BOX_FACE_EDGE_INDICES[f]
    mask |= (1 << fe[0]) | (1 << fe[1]) | (1 << fe[2]) | (1 << fe[3])
  }
  return mask
}

function strokeEdgeGroup(
  ctx: CanvasRenderingContext2D,
  points: Array<ProjectedPoint2D | null>,
  mask: number,
  drawVisible: boolean,
): void {
  ctx.beginPath()
  for (let ei = 0; ei < BOX_EDGE_PAIRS.length; ei++) {
    if (((mask & (1 << ei)) !== 0) !== drawVisible) continue
    const [a, b] = BOX_EDGE_PAIRS[ei]
    const pa = points[a], pb = points[b]
    if (!pa || !pb) continue
    ctx.moveTo(pa.u, pa.v)
    ctx.lineTo(pb.u, pb.v)
  }
  ctx.stroke()
}

function drawSingleBox(
  ctx: CanvasRenderingContext2D,
  box: ProjectedBox3DWireframe,
  near: number, far: number,
  clipMinU?: number, clipMaxU?: number, clipMinV?: number, clipMaxV?: number,
  cullMargin = DEFAULT_CULL_MARGIN_PX,
  displayScale = 1,
  isSelected = false,
): void {
  if (
    clipMinU !== undefined && clipMaxU !== undefined &&
    clipMinV !== undefined && clipMaxV !== undefined &&
    isBoxOutsideClip(box.points, clipMinU, clipMaxU, clipMinV, clipMaxV, cullMargin)
  ) return

  const baseLineW = computeLineWidth(box.depth, near, far, 1.5, 0.5)
  const lineW = isSelected ? baseLineW * 2.5 : baseLineW
  const mask = getVisibleEdgeMask(box.points)
  const { color, strokeOpacity } = box

  ctx.save()
  ctx.lineJoin = 'round'
  ctx.lineCap = 'round'

  if (isSelected) {
    // Outer glow pass using box's own color
    ctx.lineWidth = (lineW * 1.8) / displayScale
    ctx.strokeStyle = `${color}55`
    ctx.setLineDash([])
    strokeEdgeGroup(ctx, box.points, 0xfff, true)
    strokeEdgeGroup(ctx, box.points, 0xfff, false)

    // Solid highlight: all edges drawn in white at full opacity
    ctx.lineWidth = lineW / displayScale
    ctx.strokeStyle = '#ffffff'
    ctx.setLineDash([])
    strokeEdgeGroup(ctx, box.points, 0xfff, true)
    strokeEdgeGroup(ctx, box.points, 0xfff, false)
  } else {
    const visibleStroke = `${color}${Math.round(strokeOpacity * 255).toString(16).padStart(2, '0')}`
    const hiddenOpacity = Math.max(strokeOpacity * 0.55, 0.2)
    const hiddenStroke = `${color}${Math.round(hiddenOpacity * 255).toString(16).padStart(2, '0')}`

    ctx.lineWidth = lineW / displayScale
    ctx.strokeStyle = visibleStroke
    ctx.setLineDash([])
    strokeEdgeGroup(ctx, box.points, mask, true)

    ctx.strokeStyle = hiddenStroke
    _scaledHiddenEdgeDash[0] = HIDDEN_EDGE_DASH[0] / displayScale
    _scaledHiddenEdgeDash[1] = HIDDEN_EDGE_DASH[1] / displayScale
    ctx.setLineDash(_scaledHiddenEdgeDash)
    strokeEdgeGroup(ctx, box.points, mask, false)
    ctx.setLineDash([])
  }

  ctx.restore()
}

export function drawPseudo3DWireframes(
  ctx: CanvasRenderingContext2D,
  boxes: ProjectedBox3DWireframe[],
  options: WireframeDrawOptions = {},
): void {
  const near = options.near ?? 1
  const far = options.far ?? 80
  const cullMargin = options.cullMargin ?? DEFAULT_CULL_MARGIN_PX
  const displayScale = options.displayScale ?? 1
  const selectedTrackId = options.selectedTrackId ?? null

  // Draw unselected boxes first, then selected on top
  for (const box of boxes) {
    if (box.trackId === selectedTrackId) continue
    drawSingleBox(
      ctx, box, near, far,
      options.clipMinU, options.clipMaxU, options.clipMinV, options.clipMaxV,
      cullMargin, displayScale, false,
    )
  }
  for (const box of boxes) {
    if (box.trackId !== selectedTrackId) continue
    drawSingleBox(
      ctx, box, near, far,
      options.clipMinU, options.clipMaxU, options.clipMinV, options.clipMaxV,
      cullMargin, displayScale, true,
    )
  }
}
