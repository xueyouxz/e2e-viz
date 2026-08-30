import { describe, expect, it } from 'vitest'
import * as d3 from 'd3'
import { buildGridIndex, pointInPolygon, polygonPath, snapGridScale } from './spatial'
import type { ProjectionMapPoint } from './types'

describe('projection spatial rules', () => {
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
    const representatives = buildGridIndex(points, scales).get(snapGridScale(1))

    expect(representatives).toBeDefined()
    expect([...(representatives?.values() ?? [])].map(point => point.scene_name)).toEqual([
      'scene-0001'
    ])
  })
})
