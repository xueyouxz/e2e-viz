import { describe, expect, it, vi } from 'vitest'
import { drawGlyphCanvas, hitTestGlyph, type GlyphCanvasContext } from './glyphCanvasRenderer'

function context(): GlyphCanvasContext {
  return {
    clearRect: vi.fn(),
    drawImage: vi.fn(),
    restore: vi.fn(),
    save: vi.fn(),
    strokeRect: vi.fn(),
    globalAlpha: 1,
    imageSmoothingEnabled: true,
    imageSmoothingQuality: 'low',
    lineWidth: 1,
    shadowBlur: 0,
    shadowColor: 'transparent',
    shadowOffsetX: 0,
    shadowOffsetY: 0,
    strokeStyle: '#000'
  }
}

describe('hitTestGlyph', () => {
  it('returns the topmost glyph under the pointer', () => {
    const points = [
      { sceneName: 'scene-0000', x: 100, y: 100, selected: false },
      { sceneName: 'scene-0001', x: 105, y: 105, selected: false }
    ]

    expect(hitTestGlyph(points, 103, 103, 50)?.sceneName).toBe('scene-0001')
    expect(hitTestGlyph(points, 200, 200, 50)).toBeNull()
  })

  it('keeps the hovered glyph active across its enlarged edge', () => {
    const points = [{ sceneName: 'scene-0000', x: 100, y: 100, selected: false }]
    expect(hitTestGlyph(points, 128, 100, 50, 'scene-0000')?.sceneName).toBe('scene-0000')
    expect(hitTestGlyph(points, 130, 100, 50, 'scene-0000')).toBeNull()
  })

  it('hits the visually raised hovered glyph before overlapping points', () => {
    const points = [
      { sceneName: 'scene-0000', x: 100, y: 100, selected: false },
      { sceneName: 'scene-0001', x: 105, y: 105, selected: false }
    ]
    expect(hitTestGlyph(points, 103, 103, 50, 'scene-0000')?.sceneName).toBe('scene-0000')
  })
})

describe('drawGlyphCanvas', () => {
  it('crops atlas slots, draws selected state, and paints the hovered glyph last', () => {
    const ctx = context()
    const atlas = {} as CanvasImageSource
    const points = [
      { sceneName: 'scene-0000', x: 100, y: 100, selected: false },
      { sceneName: 'scene-0034', x: 200, y: 200, selected: true }
    ]

    expect(
      drawGlyphCanvas(ctx, atlas, points, {
        width: 1280,
        height: 760,
        glyphSize: 50,
        hoveredSceneName: 'scene-0000'
      })
    ).toBe(2)

    const calls = vi.mocked(ctx.drawImage).mock.calls
    expect(calls).toHaveLength(2)
    expect(calls[0].slice(1, 5)).toEqual([2, 106, 100, 100])
    expect(calls[1].slice(1, 5)).toEqual([2, 2, 100, 100])
    expect(ctx.strokeRect).toHaveBeenCalledTimes(1)
  })
})
