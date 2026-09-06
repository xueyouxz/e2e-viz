import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import type { CameraInfo, CuboidPayload, EgoPose } from '../../types'
import {
  buildWorldToCameraMatrix,
  CAMERA_CHANNELS,
  CameraProjector,
  projectWorldPointToImage,
  writeCuboidCorners
} from '../cameraProjection'

const IDENTITY_POSE: EgoPose = {
  translation: [0, 0, 0],
  rotation: [1, 0, 0, 0]
}

const IDENTITY_CAMERA: CameraInfo = {
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

const CAMERAS = Object.fromEntries(CAMERA_CHANNELS.map(channel => [channel, IDENTITY_CAMERA]))

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

describe('camera projection', () => {
  it('writes the identity world-to-camera transform into the provided matrix', () => {
    const target = new THREE.Matrix4()
    const result = buildWorldToCameraMatrix(IDENTITY_POSE, IDENTITY_CAMERA, target)

    expect(result).toBe(target)
    expect(result.elements[0]).toBeCloseTo(1)
    expect(result.elements[5]).toBeCloseTo(1)
    expect(result.elements[10]).toBeCloseTo(1)
  })

  it('projects visible points and rejects points behind the camera', () => {
    const matrix = buildWorldToCameraMatrix(IDENTITY_POSE, IDENTITY_CAMERA)

    expect(
      projectWorldPointToImage(new THREE.Vector3(0, 0, 10), matrix, IDENTITY_CAMERA)
    ).toMatchObject({ u: 320, v: 240, depth: 10 })
    expect(
      projectWorldPointToImage(new THREE.Vector3(0, 0, -1), matrix, IDENTITY_CAMERA)
    ).toBeNull()
  })

  it('writes translated cuboid corners into reusable vectors', () => {
    const firstPoint = new THREE.Vector3()
    const target = [firstPoint]
    writeCuboidCorners([10, 0, 0], [2, 2, 2], [1, 0, 0, 0], target)

    expect(target).toHaveLength(8)
    expect(target[0]).toBe(firstPoint)
    expect(Math.min(...target.map(point => point.x))).toBeCloseTo(9)
    expect(Math.max(...target.map(point => point.x))).toBeCloseTo(11)
  })

  it('projects one cuboid to every calibrated camera channel', () => {
    const frame = new CameraProjector().projectFrame(createCuboid(10), IDENTITY_POSE, CAMERAS)

    for (const channel of CAMERA_CHANNELS) {
      expect(frame.projectedCuboids[channel]).toHaveLength(1)
      expect(frame.projectedCuboids[channel][0].bounds.minU).toBeLessThan(
        frame.projectedCuboids[channel][0].bounds.maxU
      )
    }
  })

  it('omits cuboids behind the camera', () => {
    const frame = new CameraProjector().projectFrame(createCuboid(-10), IDENTITY_POSE, CAMERAS)
    expect(frame.projectedCuboids.CAM_FRONT).toHaveLength(0)
  })

  it('reuses unchanged projection results without sharing instance state', () => {
    const payload = createCuboid(10)
    const firstProjector = new CameraProjector()
    const secondProjector = new CameraProjector()
    const firstFrame = firstProjector.projectFrame(payload, IDENTITY_POSE, CAMERAS)

    expect(firstProjector.projectFrame(payload, IDENTITY_POSE, CAMERAS)).toBe(firstFrame)
    expect(secondProjector.projectFrame(payload, IDENTITY_POSE, CAMERAS)).not.toBe(firstFrame)
  })
})
