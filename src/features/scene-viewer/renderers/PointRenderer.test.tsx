import * as THREE from 'three'
import { describe, expect, it, vi } from 'vitest'
import { PointRenderer } from './PointRenderer'
import { renderRenderer } from './__test__/rendererTestHarness'

describe('PointRenderer', () => {
  it('renders safely before the first point payload is available', () => {
    expect(() => renderRenderer(<PointRenderer streamName='lidar' style={{}} />)).not.toThrow()
  })

  it('disposes its geometry on unmount', () => {
    const dispose = vi.spyOn(THREE.BufferGeometry.prototype, 'dispose')
    const view = renderRenderer(<PointRenderer streamName='lidar' style={{}} />)

    view.unmount()

    expect(dispose).toHaveBeenCalledTimes(1)
  })
})
