// Dimensions are SVG viewBox units. The container scales them to CSS pixels.
export const ZOOM_EXTENT: [number, number] = [1, 16]
export const GLYPH_GRID_SIZE = 80
export const GLYPH_HOVER_SCALE = 1.18
export const GLYPH_GRID_SCALES = Array.from({ length: 13 }, (_, index) => 2 ** (index / 4))

const BASE_GLYPH_SIZE = 50
const MAX_GLYPH_SIZE = 100
const GLYPH_ZOOM_EXPONENT = 0.3

function snapGridScale(scale: number): number {
  return 2 ** (Math.round(Math.log2(scale) * 4) / 4)
}

export function resolveGlyphLayout(zoom: number) {
  const k = Number.isFinite(zoom) ? Math.max(ZOOM_EXTENT[0], Math.min(ZOOM_EXTENT[1], zoom)) : 1
  const zoomGrowth = k ** GLYPH_ZOOM_EXPONENT
  const glyphSize = Math.min(MAX_GLYPH_SIZE, BASE_GLYPH_SIZE * zoomGrowth)
  const effectiveGrowth = glyphSize / BASE_GLYPH_SIZE
  return {
    glyphSize,
    gridScale: snapGridScale(k / effectiveGrowth),
    cullingPadding: (glyphSize * GLYPH_HOVER_SCALE) / 2
  }
}
