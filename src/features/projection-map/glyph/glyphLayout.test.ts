import { describe, expect, it } from 'vitest'
import { GLYPH_GRID_SCALES, GLYPH_HOVER_SCALE, resolveGlyphLayout } from './glyphLayout'
import { hitTestGlyph } from './glyphCanvasRenderer'

describe('glyph zoom layout', () => {
  it('grows sublinearly with zoom and caps at twice the overview size', () => {
    expect(resolveGlyphLayout(1).glyphSize).toBe(50)
    expect(resolveGlyphLayout(2).glyphSize).toBeCloseTo(61.5572, 4)
    expect(resolveGlyphLayout(4).glyphSize).toBeCloseTo(75.7858, 4)
    expect(resolveGlyphLayout(8).glyphSize).toBeCloseTo(93.3033, 4)
    expect(resolveGlyphLayout(16).glyphSize).toBe(100)
    expect(resolveGlyphLayout(100).glyphSize).toBe(100)
  })

  it('grows continuously and always chooses a precomputed grid level', () => {
    expect(GLYPH_GRID_SCALES).toHaveLength(13)
    expect(GLYPH_GRID_SCALES.at(-1)).toBe(8)

    let previous = 50
    for (let k = 1; k <= 16; k += 0.01) {
      const layout = resolveGlyphLayout(k)
      expect(layout.glyphSize).toBeGreaterThanOrEqual(previous)
      expect(layout.glyphSize - previous).toBeLessThan(0.16)
      expect(GLYPH_GRID_SCALES).toContain(layout.gridScale)
      expect(layout.cullingPadding).toBe((layout.glyphSize * GLYPH_HOVER_SCALE) / 2)
      previous = layout.glyphSize
    }
  })

  it('hits the enlarged glyph and hover edges with the same layout used for drawing', () => {
    const points = [{ sceneName: 'scene-0000', x: 100, y: 100, selected: false }]
    expect(hitTestGlyph(points, 130, 100, resolveGlyphLayout(1).glyphSize)).toBeNull()
    expect(hitTestGlyph(points, 130, 100, resolveGlyphLayout(16).glyphSize)?.sceneName).toBe(
      'scene-0000'
    )
    expect(
      hitTestGlyph(points, 158, 100, resolveGlyphLayout(16).glyphSize, 'scene-0000')?.sceneName
    ).toBe('scene-0000')
  })
})
