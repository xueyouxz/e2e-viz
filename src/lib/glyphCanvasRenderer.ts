import { glyphAtlasSourceRect } from './glyphAtlas'

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

export function hitTestGlyph(
  points: readonly GlyphScreenPoint[],
  x: number,
  y: number,
  glyphSize: number
): GlyphScreenPoint | null {
  const half = glyphSize / 2
  for (let index = points.length - 1; index >= 0; index -= 1) {
    const point = points[index]
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
    const size = options.glyphSize * (isHovered ? 1.18 : 1)
    const left = point.x - size / 2
    const top = point.y - size / 2

    context.save()
    context.globalAlpha = options.opacity ?? 1
    if (isHovered) {
      context.shadowColor = 'rgb(15 23 42 / 32%)'
      context.shadowBlur = 10
      context.shadowOffsetY = 3
    }
    context.drawImage(atlas, source.sx, source.sy, source.size, source.size, left, top, size, size)

    if (point.selected) {
      context.shadowColor = 'transparent'
      context.shadowBlur = 0
      context.shadowOffsetY = 0
      context.strokeStyle = '#f88f06'
      context.lineWidth = 2.5
      context.strokeRect(left + 1.25, top + 1.25, size - 2.5, size - 2.5)
    }
    context.restore()
    drawn += 1
  }
  return drawn
}
