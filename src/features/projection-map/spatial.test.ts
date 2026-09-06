import { describe, expect, it } from 'vitest'
import * as d3 from 'd3'
import {
  buildGridIndex,
  pointInPolygon,
  polygonPath,
  queryVisibleGridPoints,
  selectPointsInPolygon,
  toDataPolygon,
  reprojectPolygon,
  computeFitTransform,
  viewBoxBounds,
  type GridIndex,
  type Viewport
} from './spatial'
import { resolveGlyphLayout } from './glyph/glyphLayout'
import type { ProjectionMapPoint } from './types'

function query(
  indexes: GridIndex[],
  viewport: Viewport,
  width: number,
  height: number,
  padding: number
) {
  return queryVisibleGridPoints(
    indexes,
    viewport,
    { x: 0, y: 0, width, height },
    {
      ...resolveGlyphLayout(viewport.k),
      cullingPadding: padding
    }
  )
}

describe('projection spatial rules', () => {
  it.each([
    ['top', 1280, 1000, 640, -60],
    ['bottom', 1280, 1000, 640, 820],
    ['left', 1600, 760, -80, 380],
    ['right', 1600, 760, 1360, 380]
  ] as const)(
    'retains glyphs in the %s letterbox during pan and zoom',
    (_, width, height, x, y) => {
      const point: ProjectionMapPoint = {
        scene_name: 'scene-0000',
        scene_token: '0',
        split: 'train',
        tsne_comp1: 40,
        tsne_comp2: 40
      }
      const scales = { x: d3.scaleLinear([0, 80], [0, 80]), y: d3.scaleLinear([0, 80], [0, 80]) }
      const index = buildGridIndex([point], scales)
      const bounds = viewBoxBounds(width, height)
      for (const k of [1, 4, 16]) {
        const viewport = { k, tx: x - 40 * k, ty: y - 40 * k }
        expect(queryVisibleGridPoints([index], viewport, bounds).map(p => p.point)).toEqual([point])
        // The old fixed query rectangle drops this same visible glyph completely.
        expect(
          queryVisibleGridPoints([index], viewport, { x: 0, y: 0, width: 1280, height: 760 })
        ).toEqual([])
        const outside = { ...viewport, tx: bounds.x - 100 - 40 * k }
        expect(queryVisibleGridPoints([index], outside, bounds)).toEqual([])
      }
    }
  )

  it('keeps lasso hit testing and path serialization aligned', () => {
    const polygon: [number, number][] = [
      [0, 0],
      [10, 0],
      [10, 10],
      [0, 10]
    ]
    expect(pointInPolygon(5, 5, polygon)).toBe(true)
    expect(pointInPolygon(12, 5, polygon)).toBe(false)
    expect(polygonPath(polygon)).toBe('M0.0,0.0L10.0,0.0L10.0,10.0L0.0,10.0Z')
  })

  it('selects one deterministic representative per LOD cell', () => {
    const points: ProjectionMapPoint[] = [
      {
        scene_name: 'scene-0000',
        scene_token: '0',
        split: 'train',
        tsne_comp1: 10,
        tsne_comp2: 10
      },
      { scene_name: 'scene-0001', scene_token: '1', split: 'train', tsne_comp1: 35, tsne_comp2: 35 }
    ]
    const scales = { x: d3.scaleLinear([0, 80], [0, 80]), y: d3.scaleLinear([0, 80], [0, 80]) }
    const visible = query([buildGridIndex(points, scales)], { k: 1, tx: 0, ty: 0 }, 80, 80, 0)

    expect(visible.map(({ point }) => point.scene_name)).toEqual(['scene-0001'])
  })

  it('updates visible glyphs from the current pan transform without waiting for zoom end', () => {
    const points: ProjectionMapPoint[] = [
      {
        scene_name: 'scene-left',
        scene_token: 'left',
        split: 'train',
        tsne_comp1: 40,
        tsne_comp2: 40
      },
      {
        scene_name: 'scene-right',
        scene_token: 'right',
        split: 'train',
        tsne_comp1: 200,
        tsne_comp2: 40
      }
    ]
    const scales = {
      x: d3.scaleLinear([0, 240], [0, 240]),
      y: d3.scaleLinear([0, 80], [0, 80])
    }
    const index = buildGridIndex(points, scales)

    const beforePan = query([index], { k: 1, tx: 0, ty: 0 }, 80, 80, 25)
    const duringPan = query([index], { k: 1, tx: -160, ty: 0 }, 80, 80, 25)

    expect(beforePan.map(({ point }) => point.scene_name)).toEqual(['scene-left'])
    expect(duringPan.map(({ point }) => point.scene_name)).toEqual(['scene-right'])
  })

  it('queries the LOD selected by the current zoom transform', () => {
    const points: ProjectionMapPoint[] = [
      {
        scene_name: 'scene-0000',
        scene_token: '0',
        split: 'train',
        tsne_comp1: 10,
        tsne_comp2: 40
      },
      {
        scene_name: 'scene-0001',
        scene_token: '1',
        split: 'train',
        tsne_comp1: 70,
        tsne_comp2: 40
      }
    ]
    const scales = { x: d3.scaleLinear([0, 160], [0, 160]), y: d3.scaleLinear([0, 80], [0, 80]) }
    const index = buildGridIndex(points, scales)

    const lowerZoom = 1.1
    const higherZoom = 1.15
    const lowerLod = query([index], { k: lowerZoom, tx: 0, ty: 0 }, 200, 100, 0)
    const higherLod = query([index], { k: higherZoom, tx: 0, ty: 0 }, 200, 100, 0)

    expect(resolveGlyphLayout(lowerZoom).gridScale).toBe(1)
    expect(lowerLod).toHaveLength(1)
    expect(resolveGlyphLayout(higherZoom).gridScale).toBeGreaterThan(1)
    expect(higherLod).toHaveLength(2)
  })

  it('breaks equal-distance ties by scene name regardless of split order', () => {
    const scales = { x: d3.scaleLinear([0, 80], [0, 80]), y: d3.scaleLinear([0, 80], [0, 80]) }
    const train = buildGridIndex(
      [
        {
          scene_name: 'scene-train',
          scene_token: 'train',
          split: 'train',
          tsne_comp1: 40,
          tsne_comp2: 40
        }
      ],
      scales
    )
    const val = buildGridIndex(
      [
        {
          scene_name: 'scene-val',
          scene_token: 'val',
          split: 'val',
          tsne_comp1: 40,
          tsne_comp2: 40
        }
      ],
      scales
    )

    const visible = query([train, val], { k: 1, tx: 0, ty: 0 }, 80, 80, 0)

    expect(visible.map(({ point }) => point.scene_name)).toEqual(['scene-train'])
    expect(query([val, train], { k: 1, tx: 0, ty: 0 }, 80, 80, 0)).toEqual(visible)
  })
})

describe('adaptive grid and data-space selection', () => {
  const scales = { x: d3.scaleLinear([0, 160], [0, 160]), y: d3.scaleLinear([0, 80], [0, 80]) }
  function point(name: string, x: number, split: 'train' | 'val' = 'train'): ProjectionMapPoint {
    return { scene_name: name, scene_token: name, tsne_comp1: x, tsne_comp2: 40, split }
  }

  it('chooses the closest point across splits instead of preferring train', () => {
    const train = buildGridIndex([point('scene-a', 10)], scales)
    const val = buildGridIndex([point('scene-b', 40, 'val')], scales)
    expect(
      query([train, val], { k: 1, tx: 0, ty: 0 }, 80, 80, 0).map(p => p.point.scene_name)
    ).toEqual(['scene-b'])
  })

  it('uses a coarser density level at high zoom and retains glyphs at the enlarged viewport edge', () => {
    const index = buildGridIndex([point('scene-0000', 10)], scales)
    const viewport = { k: 16, tx: -194, ty: -600 }
    const visible = queryVisibleGridPoints([index], viewport, { x: 0, y: 0, width: 80, height: 80 })
    // Center x=-34: outside the old 25-unit padding, inside the enlarged hover bounds.
    expect(visible.map(p => p.point.scene_name)).toEqual(['scene-0000'])
    expect(resolveGlyphLayout(16).gridScale).toBeLessThan(16)
  })

  it('preserves selection when a polygon is transformed to the screen and back', () => {
    const polygon: [number, number][] = [
      [0, 0],
      [50, 0],
      [50, 80],
      [0, 80]
    ]
    const transform = d3.zoomIdentity.translate(-120, 35).scale(8)
    const restored = toDataPolygon(reprojectPolygon(polygon, scales, transform), scales, transform)
    expect(
      selectPointsInPolygon([point('inside', 25), point('outside', 90)], restored).map(
        p => p.scene_name
      )
    ).toEqual(['inside'])
  })

  it('keeps fit transforms within the interactive zoom range', () => {
    expect(computeFitTransform([], scales).k).toBe(1)
    const wideScales = { x: d3.scaleLinear([0, 160], [18, 1262]), y: scales.y }
    expect(
      computeFitTransform([point('left', 0), point('right', 160)], wideScales).k
    ).toBeGreaterThanOrEqual(1)
  })
})
