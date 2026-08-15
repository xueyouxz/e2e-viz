const MIN_PIXEL_RATIO = 1
const MAX_PIXEL_RATIO = 2

export function resolveGlyphCanvasPixelRatio(devicePixelRatio?: number): number {
  if (!Number.isFinite(devicePixelRatio)) return MIN_PIXEL_RATIO
  return Math.min(MAX_PIXEL_RATIO, Math.max(MIN_PIXEL_RATIO, devicePixelRatio ?? 1))
}
