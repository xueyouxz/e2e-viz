import { describe, it, expect } from 'vitest'
import * as THREE from 'three'
import {
  buildWorldToCameraMatrix,
  projectWorldToImageWithMatrix,
  getBoxCornersInto
} from './projection'

const IDENTITY_POSE = {
  translation: [0, 0, 0] as [number, number, number],
  rotation: [1, 0, 0, 0] as [number, number, number, number]
}

const IDENTITY_CAM_INFO = {
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

describe('buildWorldToCameraMatrix', () => {
  it('returns a Matrix4', () => {
    const result = buildWorldToCameraMatrix(IDENTITY_POSE, IDENTITY_CAM_INFO)
    expect(result).toBeInstanceOf(THREE.Matrix4)
  })

  it('writes into provided out matrix', () => {
    const out = new THREE.Matrix4()
    const result = buildWorldToCameraMatrix(IDENTITY_POSE, IDENTITY_CAM_INFO, out)
    expect(result).toBe(out)
  })

  it('with identity ego and camera extrinsic, world-to-camera is identity', () => {
    const m = buildWorldToCameraMatrix(IDENTITY_POSE, IDENTITY_CAM_INFO)
    const elements = m.elements
    // diagonal should be ~1
    expect(elements[0]).toBeCloseTo(1)
    expect(elements[5]).toBeCloseTo(1)
    expect(elements[10]).toBeCloseTo(1)
    expect(elements[15]).toBeCloseTo(1)
  })

  it('translating ego shifts points in opposite direction', () => {
    const ego = {
      translation: [10, 0, 0] as [number, number, number],
      rotation: [1, 0, 0, 0] as [number, number, number, number]
    }
    const m = buildWorldToCameraMatrix(ego, IDENTITY_CAM_INFO)
    const worldPt = new THREE.Vector3(10, 0, 0)
    const camPt = worldPt.clone().applyMatrix4(m)
    // world point at ego origin should map near camera origin
    expect(camPt.x).toBeCloseTo(0)
    expect(camPt.y).toBeCloseTo(0)
  })
})

describe('projectWorldToImageWithMatrix', () => {
  it('returns null for points behind camera (z <= 0.1)', () => {
    const m = buildWorldToCameraMatrix(IDENTITY_POSE, IDENTITY_CAM_INFO)
    const behind = new THREE.Vector3(0, 0, -1)
    expect(projectWorldToImageWithMatrix(behind, m, IDENTITY_CAM_INFO)).toBeNull()
  })

  it('returns pixel coordinates for point in front', () => {
    const m = buildWorldToCameraMatrix(IDENTITY_POSE, IDENTITY_CAM_INFO)
    const pt = new THREE.Vector3(0, 0, 5)
    const result = projectWorldToImageWithMatrix(pt, m, IDENTITY_CAM_INFO)
    expect(result).not.toBeNull()
    expect(result!.depth).toBeCloseTo(5)
    expect(typeof result!.u).toBe('number')
    expect(typeof result!.v).toBe('number')
  })

  it('point on optical axis projects to principal point', () => {
    const m = buildWorldToCameraMatrix(IDENTITY_POSE, IDENTITY_CAM_INFO)
    const pt = new THREE.Vector3(0, 0, 10)
    const result = projectWorldToImageWithMatrix(pt, m, IDENTITY_CAM_INFO)
    // u = fx * x/z + cx = 500*0/10 + 320 = 320
    expect(result!.u).toBeCloseTo(320)
  })
})

describe('getBoxCornersInto', () => {
  it('returns 8 corners', () => {
    const out: THREE.Vector3[] = []
    getBoxCornersInto([0, 0, 0], [2, 2, 2], [1, 0, 0, 0], out)
    expect(out).toHaveLength(8)
    out.forEach(v => expect(v).toBeInstanceOf(THREE.Vector3))
  })

  it('unit cube at origin has corners at ±0.5 in each axis', () => {
    const out: THREE.Vector3[] = []
    getBoxCornersInto([0, 0, 0], [1, 1, 1], [1, 0, 0, 0], out)
    const xs = out.map(v => v.x)
    expect(Math.min(...xs)).toBeCloseTo(-0.5)
    expect(Math.max(...xs)).toBeCloseTo(0.5)
  })

  it('translates corners by center offset', () => {
    const out: THREE.Vector3[] = []
    getBoxCornersInto([10, 0, 0], [2, 2, 2], [1, 0, 0, 0], out)
    const xs = out.map(v => v.x)
    expect(Math.min(...xs)).toBeCloseTo(9)
    expect(Math.max(...xs)).toBeCloseTo(11)
  })

  it('reuses existing Vector3 instances in out array', () => {
    const existing = new THREE.Vector3()
    const out: THREE.Vector3[] = [existing]
    getBoxCornersInto([0, 0, 0], [1, 1, 1], [1, 0, 0, 0], out)
    expect(out[0]).toBe(existing)
  })
})
