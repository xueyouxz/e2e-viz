import { describe, expect, it } from 'vitest'
import { CameraOverlayProjector } from './CameraOverlayProjector'
import { CAMERA_CHANNELS } from './types'
import type { CameraInfo, CuboidPayload, EgoPose } from '../types'

const EGO_POSE: EgoPose = {
  translation: [0, 0, 0],
  rotation: [1, 0, 0, 0]
}

const CAMERA: CameraInfo = {
  image_width: 640,
  image_height: 480,
  intrinsic: [
    [500, 0, 320],
    [0, 500, 240],
    [0, 0, 1]
  ],
  extrinsic: {
    translation: [0, 0, 0],
    rotation: [1, 0, 0, 0]
  }
}

const CAMERAS = Object.fromEntries(CAMERA_CHANNELS.map(channel => [channel, CAMERA]))

function createCuboid(z: number): CuboidPayload {
  return {
    type: 'cuboid',
    centers: new Float32Array([0, 0, z]),
    sizes: new Float32Array([2, 4, 2]),
    rotations: new Float32Array([1, 0, 0, 0]),
    classIds: new Uint32Array([4]),
    trackIds: new Uint32Array([42]),
    scores: null,
    count: 1
  }
}

describe('CameraOverlayProjector', () => {
  it('maps one visible cuboid to every calibrated channel with reusable bounds', () => {
    const frame = new CameraOverlayProjector().projectFrame(createCuboid(10), EGO_POSE, CAMERAS)

    for (const channel of CAMERA_CHANNELS) {
      expect(frame.projectedCuboids[channel]).toHaveLength(1)
      expect(frame.projectedCuboids[channel][0].bounds.minU).toBeLessThan(
        frame.projectedCuboids[channel][0].bounds.maxU
      )
    }
  })

  it('omits cuboids behind the camera', () => {
    const frame = new CameraOverlayProjector().projectFrame(createCuboid(-10), EGO_POSE, CAMERAS)
    expect(frame.projectedCuboids.CAM_FRONT).toHaveLength(0)
  })

  it('caches unchanged inputs without sharing instance scratch', () => {
    const payload = createCuboid(10)
    const firstProjector = new CameraOverlayProjector()
    const secondProjector = new CameraOverlayProjector()
    const firstFrame = firstProjector.projectFrame(payload, EGO_POSE, CAMERAS)

    expect(firstProjector.projectFrame(payload, EGO_POSE, CAMERAS)).toBe(firstFrame)
    expect(secondProjector.projectFrame(payload, EGO_POSE, CAMERAS)).not.toBe(firstFrame)
  })
})
