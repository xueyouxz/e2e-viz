import { glyphAtlasSourceRect } from './glyphAtlas'

const MIN_PIXEL_RATIO = 1
const MAX_PIXEL_RATIO = 2
const HOVER_SHADOW = 'rgb(15 23 42 / 32%)'
const SELECTED_STROKE = '#f88f06'

export function resolveGlyphCanvasPixelRatio(devicePixelRatio?: number): number {
  if (!Number.isFinite(devicePixelRatio)) return MIN_PIXEL_RATIO
  return Math.min(MAX_PIXEL_RATIO, Math.max(MIN_PIXEL_RATIO, devicePixelRatio ?? 1))
}

export type GlyphScreenPoint = {
  sceneName: string
  x: number
  y: number
  selected: boolean
}

export type GlyphCanvasContext = {
  clearRect(x: number, y: number, width: number, height: number): void
  drawImage(
    image: CanvasImageSource,
    sx: number,
    sy: number,
    sw: number,
    sh: number,
    dx: number,
    dy: number,
    dw: number,
    dh: number
  ): void
  restore(): void
  save(): void
  strokeRect(x: number, y: number, width: number, height: number): void
  globalAlpha: number
  imageSmoothingEnabled: boolean
  imageSmoothingQuality: ImageSmoothingQuality
  lineWidth: number
  shadowBlur: number
  shadowColor: string
  shadowOffsetX: number
  shadowOffsetY: number
  strokeStyle: string | CanvasGradient | CanvasPattern
}

type DrawGlyphCanvasOptions = {
  width: number
  height: number
  glyphSize: number
  hoveredSceneName: string | null
  opacity?: number
}

const HOVER_SCALE = 1.18

export function hitTestGlyph(
  points: readonly GlyphScreenPoint[],
  x: number,
  y: number,
  glyphSize: number,
  hoveredSceneName: string | null = null
): GlyphScreenPoint | null {
  const hovered = hoveredSceneName
    ? points.find(point => point.sceneName === hoveredSceneName)
    : undefined
  if (hovered) {
    const hoverHalf = (glyphSize * HOVER_SCALE) / 2
    if (Math.abs(x - hovered.x) <= hoverHalf && Math.abs(y - hovered.y) <= hoverHalf) {
      return hovered
    }
  }

  for (let index = points.length - 1; index >= 0; index -= 1) {
    const point = points[index]
    if (point === hovered) continue
    const half = glyphSize / 2
    if (Math.abs(x - point.x) <= half && Math.abs(y - point.y) <= half) return point
  }
  return null
}

export function drawGlyphCanvas(
  context: GlyphCanvasContext,
  atlas: CanvasImageSource,
  points: readonly GlyphScreenPoint[],
  options: DrawGlyphCanvasOptions
): number {
  context.clearRect(0, 0, options.width, options.height)
  context.imageSmoothingEnabled = true
  context.imageSmoothingQuality = 'high'

  const hovered = options.hoveredSceneName
    ? points.find(point => point.sceneName === options.hoveredSceneName)
    : undefined
  const ordered = hovered ? points.filter(point => point !== hovered).concat(hovered) : points

  let drawn = 0
  for (const point of ordered) {
    const source = glyphAtlasSourceRect(point.sceneName)
    if (!source) continue

    const isHovered = point.sceneName === options.hoveredSceneName
    const size = options.glyphSize * (isHovered ? HOVER_SCALE : 1)
    const left = point.x - size / 2
    const top = point.y - size / 2

    context.save()
    context.globalAlpha = options.opacity ?? 1
    if (isHovered) {
      context.shadowColor = HOVER_SHADOW
      context.shadowBlur = 10
      context.shadowOffsetY = 3
    }
    context.drawImage(atlas, source.sx, source.sy, source.size, source.size, left, top, size, size)

    if (point.selected) {
      context.shadowColor = 'transparent'
      context.shadowBlur = 0
      context.shadowOffsetY = 0
      context.strokeStyle = SELECTED_STROKE
      context.lineWidth = 2.5
      context.strokeRect(left + 1.25, top + 1.25, size - 2.5, size - 2.5)
    }
    context.restore()
    drawn += 1
  }
  return drawn
}
