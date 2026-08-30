import { describe, expect, it } from 'vitest'
import { computeViewportTransform, pickTrackAtViewportPoint } from './CameraOverlayCanvas'
import type { ProjectedBox3DWireframe } from './types'

function createProjectedCuboid(
  trackId: number,
  minU: number,
  maxU: number
): ProjectedBox3DWireframe {
  return {
    trackId,
    classId: 4,
    color: '#4B8CF8',
    strokeOpacity: 0.8,
    depth: 10,
    points: [],
    bounds: { minU, maxU, minV: 100, maxV: 200 }
  }
}

describe('camera viewport mapping', () => {
  it('uses the same cover transform for drawing and picking', () => {
    const transform = computeViewportTransform(400, 400, 800, 400, 'cover')
    const viewportX = 400 * transform.scale + transform.offsetX
    const viewportY = 150 * transform.scale + transform.offsetY

    expect(transform.scale).toBe(1)
    expect(transform.offsetX).toBe(-200)
    expect(
      pickTrackAtViewportPoint(
        viewportX,
        viewportY,
        [createProjectedCuboid(7, 350, 450)],
        transform
      )
    ).toBe(7)
  })

  it('picks the smallest overlapping projected bounds', () => {
    const transform = computeViewportTransform(800, 400, 800, 400, 'contain')
    const projectedCuboids = [
      createProjectedCuboid(1, 300, 500),
      createProjectedCuboid(2, 350, 450)
    ]

    expect(pickTrackAtViewportPoint(400, 150, projectedCuboids, transform)).toBe(2)
  })
})
