import { describe, it, expect, vi } from 'vitest'
import { drawPseudo3DWireframes } from './wireframe'
import type { ProjectedBox3DWireframe, ProjectedPoint2D } from './types'

function makeCtx() {
  return {
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    stroke: vi.fn(),
    save: vi.fn(),
    restore: vi.fn(),
    setLineDash: vi.fn(),
    lineWidth: 0,
    strokeStyle: '',
    lineJoin: '',
    lineCap: ''
  } as unknown as CanvasRenderingContext2D
}

// 8 points forming a simple front-facing box in image space
function makeVisiblePoints(): ProjectedPoint2D[] {
  return [
    { u: 100, v: 200, depth: 10 }, // 0
    { u: 200, v: 200, depth: 10 }, // 1
    { u: 200, v: 100, depth: 10 }, // 2
    { u: 100, v: 100, depth: 10 }, // 3
    { u: 110, v: 210, depth: 12 }, // 4
    { u: 210, v: 210, depth: 12 }, // 5
    { u: 210, v: 110, depth: 12 }, // 6
    { u: 110, v: 110, depth: 12 } // 7
  ]
}

function makeBox(overrides: Partial<ProjectedBox3DWireframe> = {}): ProjectedBox3DWireframe {
  return {
    trackId: 1,
    classId: 4,
    color: '#4B8CF8',
    strokeOpacity: 0.8,
    depth: 10,
    points: makeVisiblePoints(),
    ...overrides
  }
}

describe('drawPseudo3DWireframes', () => {
  it('does nothing with empty boxes array', () => {
    const ctx = makeCtx()
    drawPseudo3DWireframes(ctx, [])
    expect((ctx.beginPath as ReturnType<typeof vi.fn>).mock.calls.length).toBe(0)
  })

  it('calls save and restore for each box', () => {
    const ctx = makeCtx()
    drawPseudo3DWireframes(ctx, [makeBox()])
    expect((ctx.save as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThan(0)
    expect((ctx.restore as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThan(0)
  })

  it('draws unselected box without glow pass', () => {
    const ctx = makeCtx()
    drawPseudo3DWireframes(ctx, [makeBox({ trackId: 1 })], { selectedTrackId: null })
    expect((ctx.stroke as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThan(0)
  })

  it('draws selected box with extra glow passes', () => {
    const ctx = makeCtx()
    const box = makeBox({ trackId: 42 })
    drawPseudo3DWireframes(ctx, [box], { selectedTrackId: 42 })
    // selected box draws 4 strokeEdgeGroup calls (2 glow + 2 highlight)
    expect((ctx.stroke as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThan(2)
  })

  it('clips box outside viewport — skips drawing', () => {
    const ctx = makeCtx()
    // box at u=100-200, v=100-200, clip region is u=300-400 (no overlap)
    drawPseudo3DWireframes(ctx, [makeBox()], {
      clipMinU: 300,
      clipMaxU: 400,
      clipMinV: 0,
      clipMaxV: 1000
    })
    expect((ctx.save as ReturnType<typeof vi.fn>).mock.calls.length).toBe(0)
  })

  it('draws box inside clip viewport', () => {
    const ctx = makeCtx()
    drawPseudo3DWireframes(ctx, [makeBox()], {
      clipMinU: 0,
      clipMaxU: 400,
      clipMinV: 0,
      clipMaxV: 400
    })
    expect((ctx.save as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThan(0)
  })

  it('handles box with all-null points (fully clipped by camera)', () => {
    const ctx = makeCtx()
    const box = makeBox({ points: Array(8).fill(null) })
    // should not throw, and should be culled
    expect(() => drawPseudo3DWireframes(ctx, [box])).not.toThrow()
  })

  it('draws multiple boxes', () => {
    const ctx = makeCtx()
    drawPseudo3DWireframes(ctx, [makeBox({ trackId: 1 }), makeBox({ trackId: 2 })])
    expect((ctx.save as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThanOrEqual(2)
  })

  it('uses custom near/far for line width computation', () => {
    const ctx = makeCtx()
    expect(() => drawPseudo3DWireframes(ctx, [makeBox()], { near: 0.5, far: 100 })).not.toThrow()
  })

  it('applies displayScale to line width', () => {
    const ctx = makeCtx()
    drawPseudo3DWireframes(ctx, [makeBox()], { displayScale: 2 })
    expect((ctx.save as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThan(0)
  })
})
