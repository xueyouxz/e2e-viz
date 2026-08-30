import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import {
  buildWorldToCameraMatrix,
  getBoxCornersInto,
  projectWorldToImageWithMatrix
} from './projection'

const IDENTITY_POSE = {
  translation: [0, 0, 0] as [number, number, number],
  rotation: [1, 0, 0, 0] as [number, number, number, number]
}

const IDENTITY_CAMERA = {
  intrinsic: [
    [500, 0, 320],
    [0, 500, 240],
    [0, 0, 1]
  ] as [[number, number, number], [number, number, number], [number, number, number]],
  extrinsic: {
    translation: [0, 0, 0] as [number, number, number],
    rotation: [1, 0, 0, 0] as [number, number, number, number]
  }
}

describe('camera projection', () => {
  it('writes the identity world-to-camera transform into the provided matrix', () => {
    const out = new THREE.Matrix4()
    const result = buildWorldToCameraMatrix(IDENTITY_POSE, IDENTITY_CAMERA, out)

    expect(result).toBe(out)
    expect(result.elements[0]).toBeCloseTo(1)
    expect(result.elements[5]).toBeCloseTo(1)
    expect(result.elements[10]).toBeCloseTo(1)
  })

  it('rejects points behind the camera', () => {
    const matrix = buildWorldToCameraMatrix(IDENTITY_POSE, IDENTITY_CAMERA)
    expect(
      projectWorldToImageWithMatrix(new THREE.Vector3(0, 0, -1), matrix, IDENTITY_CAMERA)
    ).toBeNull()
  })

  it('projects the optical axis to the principal point', () => {
    const matrix = buildWorldToCameraMatrix(IDENTITY_POSE, IDENTITY_CAMERA)
    expect(
      projectWorldToImageWithMatrix(new THREE.Vector3(0, 0, 10), matrix, IDENTITY_CAMERA)
    ).toMatchObject({ u: 320, v: 240, depth: 10 })
  })

  it('writes translated box corners into reusable vectors', () => {
    const first = new THREE.Vector3()
    const out = [first]
    getBoxCornersInto([10, 0, 0], [2, 2, 2], [1, 0, 0, 0], out)

    expect(out).toHaveLength(8)
    expect(out[0]).toBe(first)
    expect(Math.min(...out.map(point => point.x))).toBeCloseTo(9)
    expect(Math.max(...out.map(point => point.x))).toBeCloseTo(11)
  })
})
