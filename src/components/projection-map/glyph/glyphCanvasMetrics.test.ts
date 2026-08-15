import { describe, expect, it } from 'vitest'
import { resolveGlyphCanvasPixelRatio } from './glyphCanvasMetrics'

describe('resolveGlyphCanvasPixelRatio', () => {
  it.each([
    [undefined, 1],
    [Number.NaN, 1],
    [0.75, 1],
    [1, 1],
    [1.5, 1.5],
    [2, 2],
    [3, 2]
  ])('maps %s to %s', (devicePixelRatio, expected) => {
    expect(resolveGlyphCanvasPixelRatio(devicePixelRatio)).toBe(expected)
  })
})
