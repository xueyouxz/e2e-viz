import { describe, expect, it, vi } from 'vitest'
import { drawPseudo3DWireframes } from './wireframe'
import type { ProjectedBox3DWireframe, ProjectedPoint2D } from './types'

function createContext() {
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

function createPoints(): ProjectedPoint2D[] {
  return [
    { u: 100, v: 200, depth: 10 },
    { u: 200, v: 200, depth: 10 },
    { u: 200, v: 100, depth: 10 },
    { u: 100, v: 100, depth: 10 },
    { u: 110, v: 210, depth: 12 },
    { u: 210, v: 210, depth: 12 },
    { u: 210, v: 110, depth: 12 },
    { u: 110, v: 110, depth: 12 }
  ]
}

function createBox(overrides: Partial<ProjectedBox3DWireframe> = {}): ProjectedBox3DWireframe {
  return {
    trackId: 1,
    classId: 4,
    color: '#4B8CF8',
    strokeOpacity: 0.8,
    depth: 10,
    points: createPoints(),
    bounds: { minU: 100, maxU: 210, minV: 100, maxV: 210 },
    ...overrides
  }
}

describe('camera wireframe drawing', () => {
  it('does not issue draw commands for an empty frame', () => {
    const context = createContext()
    drawPseudo3DWireframes(context, [])
    expect(context.beginPath).not.toHaveBeenCalled()
  })

  it('adds highlight passes only for the selected cuboid', () => {
    const normalContext = createContext()
    const selectedContext = createContext()
    const box = createBox({ trackId: 42 })

    drawPseudo3DWireframes(normalContext, [box])
    drawPseudo3DWireframes(selectedContext, [box], { selectedTrackId: 42 })

    expect(selectedContext.stroke).toHaveBeenCalledTimes(4)
    expect(normalContext.stroke).toHaveBeenCalledTimes(2)
  })

  it('culls bounds outside the image-space clip', () => {
    const context = createContext()
    drawPseudo3DWireframes(context, [createBox()], {
      clipMinU: 300,
      clipMaxU: 400,
      clipMinV: 0,
      clipMaxV: 1000
    })
    expect(context.save).not.toHaveBeenCalled()
  })
})
