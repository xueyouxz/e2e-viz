// @vitest-environment jsdom
import * as THREE from 'three'
import { describe, expect, it, vi } from 'vitest'
import { PointLayer } from '../PointLayer'
import { renderLayer } from './layerTestHarness'

vi.mock('@react-three/fiber', () => ({
  useFrame: vi.fn()
}))

describe('PointLayer', () => {
  it('renders safely before the first point payload is available', () => {
    expect(() => renderLayer(<PointLayer streamName='lidar' style={{}} />)).not.toThrow()
  })

  it('disposes its geometry on unmount', () => {
    const dispose = vi.spyOn(THREE.BufferGeometry.prototype, 'dispose')
    const view = renderLayer(<PointLayer streamName='lidar' style={{}} />)

    view.unmount()

    expect(dispose).toHaveBeenCalledTimes(1)
  })
})
