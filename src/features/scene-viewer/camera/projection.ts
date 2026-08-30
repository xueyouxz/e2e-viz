import * as THREE from 'three'
import type { CuboidPayload } from '../types'
import type { ProjectedPoint2D } from './types'

interface EgoPoseInput {
  translation: [number, number, number]
  rotation: [number, number, number, number]
}

interface CameraInfoInput {
  intrinsic: [[number, number, number], [number, number, number], [number, number, number]]
  extrinsic: {
    translation: [number, number, number]
    rotation: [number, number, number, number]
  }
}

export interface ProjectionScratch {
  egoPosition: THREE.Vector3
  egoQuaternion: THREE.Quaternion
  egoToWorld: THREE.Matrix4
  cameraPosition: THREE.Vector3
  cameraQuaternion: THREE.Quaternion
  cameraToEgo: THREE.Matrix4
  worldToEgo: THREE.Matrix4
  egoToCamera: THREE.Matrix4
  cameraPoint: THREE.Vector3
  boxQuaternion: THREE.Quaternion
  boxCenter: THREE.Vector3
}

export function createProjectionScratch(): ProjectionScratch {
  return {
    egoPosition: new THREE.Vector3(),
    egoQuaternion: new THREE.Quaternion(),
    egoToWorld: new THREE.Matrix4(),
    cameraPosition: new THREE.Vector3(),
    cameraQuaternion: new THREE.Quaternion(),
    cameraToEgo: new THREE.Matrix4(),
    worldToEgo: new THREE.Matrix4(),
    egoToCamera: new THREE.Matrix4(),
    cameraPoint: new THREE.Vector3(),
    boxQuaternion: new THREE.Quaternion(),
    boxCenter: new THREE.Vector3()
  }
}

export function buildWorldToCameraMatrix(
  egoPose: EgoPoseInput,
  cameraInfo: CameraInfoInput,
  out: THREE.Matrix4 = new THREE.Matrix4(),
  scratch: ProjectionScratch = createProjectionScratch()
): THREE.Matrix4 {
  scratch.egoPosition.fromArray(egoPose.translation)
  scratch.egoQuaternion.set(
    egoPose.rotation[1],
    egoPose.rotation[2],
    egoPose.rotation[3],
    egoPose.rotation[0]
  )
  scratch.egoToWorld.makeRotationFromQuaternion(scratch.egoQuaternion)
  scratch.egoToWorld.setPosition(scratch.egoPosition)

  scratch.cameraPosition.fromArray(cameraInfo.extrinsic.translation)
  scratch.cameraQuaternion.set(
    cameraInfo.extrinsic.rotation[1],
    cameraInfo.extrinsic.rotation[2],
    cameraInfo.extrinsic.rotation[3],
    cameraInfo.extrinsic.rotation[0]
  )
  scratch.cameraToEgo.makeRotationFromQuaternion(scratch.cameraQuaternion)
  scratch.cameraToEgo.setPosition(scratch.cameraPosition)

  scratch.worldToEgo.copy(scratch.egoToWorld).invert()
  scratch.egoToCamera.copy(scratch.cameraToEgo).invert()
  return out.copy(scratch.egoToCamera).multiply(scratch.worldToEgo)
}

export function projectWorldToImageInto(
  worldPoint: THREE.Vector3,
  worldToCamera: THREE.Matrix4,
  cameraInfo: CameraInfoInput,
  out: ProjectedPoint2D,
  scratch: ProjectionScratch
): boolean {
  scratch.cameraPoint.copy(worldPoint).applyMatrix4(worldToCamera)
  if (scratch.cameraPoint.z <= 0.1) return false

  const intrinsic = cameraInfo.intrinsic
  out.u = (intrinsic[0][0] * scratch.cameraPoint.x) / scratch.cameraPoint.z + intrinsic[0][2]
  out.v =
    (intrinsic[1][0] * scratch.cameraPoint.x) / scratch.cameraPoint.z +
    (intrinsic[1][1] * scratch.cameraPoint.y) / scratch.cameraPoint.z +
    intrinsic[1][2]
  out.depth = scratch.cameraPoint.z
  return true
}

export function projectWorldToImageWithMatrix(
  worldPoint: THREE.Vector3,
  worldToCamera: THREE.Matrix4,
  cameraInfo: CameraInfoInput
): ProjectedPoint2D | null {
  const out = { u: 0, v: 0, depth: 0 }
  return projectWorldToImageInto(
    worldPoint,
    worldToCamera,
    cameraInfo,
    out,
    createProjectionScratch()
  )
    ? out
    : null
}

const LOCAL_BOX_CORNERS: ReadonlyArray<readonly [number, number, number]> = [
  [-0.5, -0.5, -0.5],
  [0.5, -0.5, -0.5],
  [0.5, 0.5, -0.5],
  [-0.5, 0.5, -0.5],
  [-0.5, -0.5, 0.5],
  [0.5, -0.5, 0.5],
  [0.5, 0.5, 0.5],
  [-0.5, 0.5, 0.5]
]

function writeBoxCorners(
  centerX: number,
  centerY: number,
  centerZ: number,
  width: number,
  length: number,
  height: number,
  rotationW: number,
  rotationX: number,
  rotationY: number,
  rotationZ: number,
  out: THREE.Vector3[],
  scratch: ProjectionScratch
): THREE.Vector3[] {
  scratch.boxQuaternion.set(rotationX, rotationY, rotationZ, rotationW)
  scratch.boxCenter.set(centerX, centerY, centerZ)

  for (let index = 0; index < LOCAL_BOX_CORNERS.length; index++) {
    const target = out[index] ?? (out[index] = new THREE.Vector3())
    const [localX, localY, localZ] = LOCAL_BOX_CORNERS[index]
    target
      .set(localX * length, localY * width, localZ * height)
      .applyQuaternion(scratch.boxQuaternion)
      .add(scratch.boxCenter)
  }
  return out
}

export function getBoxCornersInto(
  center: [number, number, number],
  size: [number, number, number],
  rotationWxyz: [number, number, number, number],
  out: THREE.Vector3[],
  scratch: ProjectionScratch = createProjectionScratch()
): THREE.Vector3[] {
  return writeBoxCorners(
    center[0],
    center[1],
    center[2],
    size[0],
    size[1],
    size[2],
    rotationWxyz[0],
    rotationWxyz[1],
    rotationWxyz[2],
    rotationWxyz[3],
    out,
    scratch
  )
}

export function getCuboidCornersInto(
  payload: CuboidPayload,
  cuboidIndex: number,
  out: THREE.Vector3[],
  scratch: ProjectionScratch
): THREE.Vector3[] {
  const centerOffset = cuboidIndex * 3
  const rotationOffset = cuboidIndex * 4
  return writeBoxCorners(
    payload.centers[centerOffset],
    payload.centers[centerOffset + 1],
    payload.centers[centerOffset + 2],
    payload.sizes[centerOffset],
    payload.sizes[centerOffset + 1],
    payload.sizes[centerOffset + 2],
    payload.rotations[rotationOffset],
    payload.rotations[rotationOffset + 1],
    payload.rotations[rotationOffset + 2],
    payload.rotations[rotationOffset + 3],
    out,
    scratch
  )
}
