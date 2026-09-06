import { describe, expect, it, vi } from 'vitest'
import type { ProjectedCuboid, ProjectedImagePoint } from '../cameraProjection'
import {
  computeViewportTransform,
  drawCuboidWireframes,
  pickTrackAtViewportPoint
} from '../cameraRendering'

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

function createPoints(): ProjectedImagePoint[] {
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

function createCuboid(overrides: Partial<ProjectedCuboid> = {}): ProjectedCuboid {
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

describe('camera viewport mapping', () => {
  it('uses the same cover transform for rendering and pointer picking', () => {
    const transform = computeViewportTransform(400, 400, 800, 400, 'cover')
    const viewportX = 400 * transform.scale + transform.offsetX
    const viewportY = 150 * transform.scale + transform.offsetY

    expect(transform.scale).toBe(1)
    expect(transform.offsetX).toBe(-200)
    expect(
      pickTrackAtViewportPoint(
        viewportX,
        viewportY,
        [createCuboid({ trackId: 7, bounds: { minU: 350, maxU: 450, minV: 100, maxV: 200 } })],
        transform
      )
    ).toBe(7)
  })

  it('picks the smallest overlapping projected bounds', () => {
    const transform = computeViewportTransform(800, 400, 800, 400, 'contain')
    const projectedCuboids = [
      createCuboid({ trackId: 1, bounds: { minU: 300, maxU: 500, minV: 100, maxV: 200 } }),
      createCuboid({ trackId: 2, bounds: { minU: 350, maxU: 450, minV: 100, maxV: 200 } })
    ]

    expect(pickTrackAtViewportPoint(400, 150, projectedCuboids, transform)).toBe(2)
  })
})

describe('cuboid wireframe rendering', () => {
  it('does not issue draw commands for an empty frame', () => {
    const context = createContext()
    drawCuboidWireframes(context, [])
    expect(context.beginPath).not.toHaveBeenCalled()
  })

  it('adds highlight passes only for the selected cuboid', () => {
    const normalContext = createContext()
    const selectedContext = createContext()
    const cuboid = createCuboid({ trackId: 42 })

    drawCuboidWireframes(normalContext, [cuboid])
    drawCuboidWireframes(selectedContext, [cuboid], { selectedTrackId: 42 })

    expect(selectedContext.stroke).toHaveBeenCalledTimes(4)
    expect(normalContext.stroke).toHaveBeenCalledTimes(2)
  })

  it('culls cuboids outside the image-space clip bounds', () => {
    const context = createContext()
    drawCuboidWireframes(context, [createCuboid()], {
      clipMinU: 300,
      clipMaxU: 400,
      clipMinV: 0,
      clipMaxV: 1000
    })
    expect(context.save).not.toHaveBeenCalled()
  })
})
