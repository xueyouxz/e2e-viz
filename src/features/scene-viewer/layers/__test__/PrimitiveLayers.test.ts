import { describe, expect, it } from 'vitest'
import type * as THREE from 'three'
import { CuboidPrimitive } from '../CuboidLayer'
import { PointPrimitive } from '../PointLayer'
import { PolygonPrimitive } from '../PolygonLayer'
import { PolylinePrimitive } from '../PolylineLayer'

describe('primitive layers', () => {
  it('writes point data into its draw range', () => {
    const layer = new PointPrimitive()

    layer.update(
      { points: new Float32Array([1, 2, 3]), intensity: null },
      { visible: true, color: '#ffffff', opacity: 1, renderOrder: 0 }
    )

    expect(layer.object.geometry.drawRange.count).toBe(1)
    layer.dispose()
  })

  it('builds a ribbon for a polyline', () => {
    const layer = new PolylinePrimitive()

    layer.update(
      {
        vertices: new Float32Array([0, 0, 0, 1, 0, 0]),
        offsets: new Uint32Array([0, 2]),
        count: 1
      },
      {
        visible: true,
        color: '#ffffff',
        lineWidth: 0.5,
        opacity: 1,
        renderOrder: 0
      }
    )

    expect(layer.object.geometry.drawRange.count).toBe(6)
    layer.dispose()
  })

  it('triangulates polygon fills and outlines', () => {
    const layer = new PolygonPrimitive()

    layer.update(
      {
        vertices: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
        offsets: new Uint32Array([0, 3]),
        count: 1
      },
      {
        visible: true,
        color: '#ffffff',
        outlineColor: '#ffffff',
        opacity: 1,
        outlineWidth: 1,
        renderOrder: 0
      }
    )

    const fill = layer.object.children[0] as THREE.Mesh
    const outline = layer.object.children[1] as THREE.LineSegments<THREE.InstancedBufferGeometry>
    expect(fill.geometry.drawRange.count).toBe(3)
    expect(outline.geometry.instanceCount).toBe(3)
    layer.dispose()
  })

  it('renders cuboids as instanced fills and outlines', () => {
    const layer = new CuboidPrimitive()

    layer.update(
      {
        centers: new Float32Array([1, 2, 3]),
        sizes: new Float32Array([2, 4, 1]),
        rotations: new Float32Array([1, 0, 0, 0]),
        count: 1
      },
      { visible: true, color: '#ffffff', opacity: 0.5, renderOrder: 0 }
    )

    expect(layer.fillObject.count).toBe(1)
    expect(layer.outlineObject.geometry.drawRange.count).toBe(24)
    layer.dispose()
  })
})
