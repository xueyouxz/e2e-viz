import * as THREE from 'three'
import type { ProjectedPoint2D } from './types'

// Minimal structural interfaces — compatible with scene-viewer types.
interface EgoPoseInput {
  translation: [number, number, number]
  rotation: [number, number, number, number] // [w, x, y, z]
}

interface CameraInfoInput {
  intrinsic: [[number, number, number], [number, number, number], [number, number, number]]
  extrinsic: {
    translation: [number, number, number]
    rotation: [number, number, number, number]
  }
}

// Module-level reusable vectors — avoids per-call allocations in projection hot path.
const _egoPos = new THREE.Vector3()
const _egoQuat = new THREE.Quaternion()
const _egoToWorld = new THREE.Matrix4()

const _camPos = new THREE.Vector3()
const _camQuat = new THREE.Quaternion()
const _camToEgo = new THREE.Matrix4()

const _worldToEgo = new THREE.Matrix4()
const _egoToCam = new THREE.Matrix4()
const _camPoint = new THREE.Vector3()

const LOCAL_BOX_CORNERS: ReadonlyArray<readonly [number, number, number]> = [
  [-0.5, -0.5, -0.5],
  [0.5, -0.5, -0.5],
  [0.5, 0.5, -0.5],
  [-0.5, 0.5, -0.5],
  [-0.5, -0.5, 0.5],
  [0.5, -0.5, 0.5],
  [0.5, 0.5, 0.5],
  [-0.5, 0.5, 0.5],
]

const _boxQuat = new THREE.Quaternion()
const _boxCenter = new THREE.Vector3()

export function buildWorldToCameraMatrix(
  egoPose: EgoPoseInput,
  camInfo: CameraInfoInput,
  out: THREE.Matrix4 = new THREE.Matrix4(),
): THREE.Matrix4 {
  _egoPos.fromArray(egoPose.translation)
  _egoQuat.set(egoPose.rotation[1], egoPose.rotation[2], egoPose.rotation[3], egoPose.rotation[0])
  _egoToWorld.makeRotationFromQuaternion(_egoQuat)
  _egoToWorld.setPosition(_egoPos)

  _camPos.fromArray(camInfo.extrinsic.translation)
  _camQuat.set(
    camInfo.extrinsic.rotation[1],
    camInfo.extrinsic.rotation[2],
    camInfo.extrinsic.rotation[3],
    camInfo.extrinsic.rotation[0],
  )
  _camToEgo.makeRotationFromQuaternion(_camQuat)
  _camToEgo.setPosition(_camPos)

  _worldToEgo.copy(_egoToWorld).invert()
  _egoToCam.copy(_camToEgo).invert()

  return out.copy(_egoToCam).multiply(_worldToEgo)
}

export function projectWorldToImageWithMatrix(
  worldPt: THREE.Vector3,
  worldToCamera: THREE.Matrix4,
  camInfo: CameraInfoInput,
): ProjectedPoint2D | null {
  _camPoint.copy(worldPt).applyMatrix4(worldToCamera)
  if (_camPoint.z <= 0.1) return null

  const k = camInfo.intrinsic
  const u = k[0][0] * _camPoint.x / _camPoint.z + k[0][2]
  const v = k[1][0] * _camPoint.x / _camPoint.z + k[1][1] * _camPoint.y / _camPoint.z + k[1][2]

  return { u, v, depth: _camPoint.z }
}

export function getBoxCornersInto(
  center: [number, number, number],
  size: [number, number, number],
  rotWXYZ: [number, number, number, number],
  out: THREE.Vector3[],
): THREE.Vector3[] {
  const [w, l, h] = size

  _boxQuat.set(rotWXYZ[1], rotWXYZ[2], rotWXYZ[3], rotWXYZ[0])
  _boxCenter.set(center[0], center[1], center[2])

  for (let i = 0; i < 8; i++) {
    const target = out[i] ?? (out[i] = new THREE.Vector3())
    const [lx, ly, lz] = LOCAL_BOX_CORNERS[i]

    target
      .set(lx * l, ly * w, lz * h)
      .applyQuaternion(_boxQuat)
      .add(_boxCenter)
  }

  return out
}
