import * as THREE from 'three'
import { getObjectColor } from '../styleConfig'
import type { CameraInfo, CuboidPayload, EgoPose } from '../types'

export interface ProjectedImagePoint {
  u: number
  v: number
  depth: number
}

interface ImageBounds {
  minU: number
  maxU: number
  minV: number
  maxV: number
}

export interface ProjectedCuboid {
  trackId: number
  classId: number
  color: string
  strokeOpacity: number
  depth: number
  points: Array<ProjectedImagePoint | null>
  bounds: ImageBounds
}

// NUSVIZ protocol-defined camera channel identifiers.
export const CAMERA_CHANNELS = [
  'CAM_FRONT',
  'CAM_FRONT_LEFT',
  'CAM_FRONT_RIGHT',
  'CAM_BACK',
  'CAM_BACK_LEFT',
  'CAM_BACK_RIGHT'
] as const satisfies string[]

export type CameraChannel = (typeof CAMERA_CHANNELS)[number]

export interface CameraProjectionFrame {
  version: number
  projectedCuboids: Record<CameraChannel, ProjectedCuboid[]>
}

interface ProjectionScratch {
  egoPosition: THREE.Vector3
  egoQuaternion: THREE.Quaternion
  egoToWorld: THREE.Matrix4
  cameraPosition: THREE.Vector3
  cameraQuaternion: THREE.Quaternion
  cameraToEgo: THREE.Matrix4
  worldToEgo: THREE.Matrix4
  egoToCamera: THREE.Matrix4
  cameraPoint: THREE.Vector3
  cuboidQuaternion: THREE.Quaternion
  cuboidCenter: THREE.Vector3
}

function createProjectionScratch(): ProjectionScratch {
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
    cuboidQuaternion: new THREE.Quaternion(),
    cuboidCenter: new THREE.Vector3()
  }
}

export function buildWorldToCameraMatrix(
  egoPose: EgoPose,
  camera: CameraInfo,
  target = new THREE.Matrix4(),
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

  scratch.cameraPosition.fromArray(camera.extrinsic.translation)
  scratch.cameraQuaternion.set(
    camera.extrinsic.rotation[1],
    camera.extrinsic.rotation[2],
    camera.extrinsic.rotation[3],
    camera.extrinsic.rotation[0]
  )
  scratch.cameraToEgo.makeRotationFromQuaternion(scratch.cameraQuaternion)
  scratch.cameraToEgo.setPosition(scratch.cameraPosition)

  scratch.worldToEgo.copy(scratch.egoToWorld).invert()
  scratch.egoToCamera.copy(scratch.cameraToEgo).invert()
  return target.copy(scratch.egoToCamera).multiply(scratch.worldToEgo)
}

function projectWorldPoint(
  worldPoint: THREE.Vector3,
  worldToCamera: THREE.Matrix4,
  camera: CameraInfo,
  target: ProjectedImagePoint,
  scratch: ProjectionScratch
): boolean {
  scratch.cameraPoint.copy(worldPoint).applyMatrix4(worldToCamera)
  if (scratch.cameraPoint.z <= 0.1) return false

  const intrinsic = camera.intrinsic
  target.u = (intrinsic[0][0] * scratch.cameraPoint.x) / scratch.cameraPoint.z + intrinsic[0][2]
  target.v =
    (intrinsic[1][0] * scratch.cameraPoint.x) / scratch.cameraPoint.z +
    (intrinsic[1][1] * scratch.cameraPoint.y) / scratch.cameraPoint.z +
    intrinsic[1][2]
  target.depth = scratch.cameraPoint.z
  return true
}

export function projectWorldPointToImage(
  worldPoint: THREE.Vector3,
  worldToCamera: THREE.Matrix4,
  camera: CameraInfo
): ProjectedImagePoint | null {
  const target = { u: 0, v: 0, depth: 0 }
  return projectWorldPoint(worldPoint, worldToCamera, camera, target, createProjectionScratch())
    ? target
    : null
}

const LOCAL_CUBOID_CORNERS: ReadonlyArray<readonly [number, number, number]> = [
  [-0.5, -0.5, -0.5],
  [0.5, -0.5, -0.5],
  [0.5, 0.5, -0.5],
  [-0.5, 0.5, -0.5],
  [-0.5, -0.5, 0.5],
  [0.5, -0.5, 0.5],
  [0.5, 0.5, 0.5],
  [-0.5, 0.5, 0.5]
]

function writeCuboidCornersFromValues(
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
  target: THREE.Vector3[],
  scratch: ProjectionScratch
): THREE.Vector3[] {
  scratch.cuboidQuaternion.set(rotationX, rotationY, rotationZ, rotationW)
  scratch.cuboidCenter.set(centerX, centerY, centerZ)

  for (let index = 0; index < LOCAL_CUBOID_CORNERS.length; index++) {
    const point = target[index] ?? (target[index] = new THREE.Vector3())
    const [localX, localY, localZ] = LOCAL_CUBOID_CORNERS[index]
    point
      .set(localX * length, localY * width, localZ * height)
      .applyQuaternion(scratch.cuboidQuaternion)
      .add(scratch.cuboidCenter)
  }
  return target
}

export function writeCuboidCorners(
  center: [number, number, number],
  size: [number, number, number],
  rotationWxyz: [number, number, number, number],
  target: THREE.Vector3[]
): THREE.Vector3[] {
  return writeCuboidCornersFromValues(
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
    target,
    createProjectionScratch()
  )
}

function writePayloadCuboidCorners(
  payload: CuboidPayload,
  cuboidIndex: number,
  target: THREE.Vector3[],
  scratch: ProjectionScratch
): THREE.Vector3[] {
  const centerOffset = cuboidIndex * 3
  const rotationOffset = cuboidIndex * 4
  return writeCuboidCornersFromValues(
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
    target,
    scratch
  )
}

interface ProjectedCuboidBuffer {
  cuboid: ProjectedCuboid
  points: ProjectedImagePoint[]
}

interface ChannelProjectionState {
  worldToCamera: THREE.Matrix4
  projectedCuboids: ProjectedCuboid[]
  buffers: ProjectedCuboidBuffer[]
}

function createChannelState(): ChannelProjectionState {
  return {
    worldToCamera: new THREE.Matrix4(),
    projectedCuboids: [],
    buffers: []
  }
}

function createProjectedCuboidBuffer(): ProjectedCuboidBuffer {
  const points = Array.from({ length: 8 }, () => ({ u: 0, v: 0, depth: 0 }))
  return {
    points,
    cuboid: {
      trackId: 0,
      classId: 0,
      color: '#9CA3AF',
      strokeOpacity: 0.64,
      depth: 0,
      points: [...points],
      bounds: { minU: 0, maxU: 0, minV: 0, maxV: 0 }
    }
  }
}

export class CameraProjector {
  private readonly scratch = createProjectionScratch()
  private readonly cuboidCenter = new THREE.Vector3()
  private readonly cuboidCorners = Array.from({ length: 8 }, () => new THREE.Vector3())
  private readonly projectedCenter: ProjectedImagePoint = { u: 0, v: 0, depth: 0 }
  private readonly channelStates: Record<CameraChannel, ChannelProjectionState>
  private readonly projectionFrame: CameraProjectionFrame
  private previousCuboids: CuboidPayload | undefined
  private previousEgoPose: EgoPose | null = null
  private previousCameras: Record<string, CameraInfo> | undefined

  constructor() {
    this.channelStates = {
      CAM_FRONT: createChannelState(),
      CAM_FRONT_LEFT: createChannelState(),
      CAM_FRONT_RIGHT: createChannelState(),
      CAM_BACK: createChannelState(),
      CAM_BACK_LEFT: createChannelState(),
      CAM_BACK_RIGHT: createChannelState()
    }
    this.projectionFrame = {
      version: 0,
      projectedCuboids: Object.fromEntries(
        CAMERA_CHANNELS.map(channel => [channel, this.channelStates[channel].projectedCuboids])
      ) as Record<CameraChannel, ProjectedCuboid[]>
    }
  }

  projectFrame(
    cuboids: CuboidPayload | undefined,
    egoPose: EgoPose | null,
    cameras: Record<string, CameraInfo>
  ): CameraProjectionFrame {
    if (
      cuboids === this.previousCuboids &&
      egoPose === this.previousEgoPose &&
      cameras === this.previousCameras
    ) {
      return this.projectionFrame
    }

    this.previousCuboids = cuboids
    this.previousEgoPose = egoPose
    this.previousCameras = cameras
    this.projectionFrame.version++
    for (const channel of CAMERA_CHANNELS) {
      this.channelStates[channel].projectedCuboids.length = 0
    }

    if (!egoPose || !cuboids || cuboids.type !== 'cuboid') return this.projectionFrame

    for (const channel of CAMERA_CHANNELS) {
      const camera = cameras[channel]
      if (!camera) continue
      const channelState = this.channelStates[channel]
      buildWorldToCameraMatrix(egoPose, camera, channelState.worldToCamera, this.scratch)
    }

    for (let cuboidIndex = 0; cuboidIndex < cuboids.count; cuboidIndex++) {
      const centerOffset = cuboidIndex * 3
      this.cuboidCenter.set(
        cuboids.centers[centerOffset],
        cuboids.centers[centerOffset + 1],
        cuboids.centers[centerOffset + 2]
      )
      writePayloadCuboidCorners(cuboids, cuboidIndex, this.cuboidCorners, this.scratch)
      const classId = cuboids.classIds[cuboidIndex]
      const trackId = cuboids.trackIds?.[cuboidIndex] ?? cuboidIndex
      const color = getObjectColor(classId)

      for (const channel of CAMERA_CHANNELS) {
        const camera = cameras[channel]
        if (!camera) continue
        const channelState = this.channelStates[channel]
        if (
          !projectWorldPoint(
            this.cuboidCenter,
            channelState.worldToCamera,
            camera,
            this.projectedCenter,
            this.scratch
          )
        ) {
          continue
        }

        const bufferIndex = channelState.projectedCuboids.length
        const buffer =
          channelState.buffers[bufferIndex] ??
          (channelState.buffers[bufferIndex] = createProjectedCuboidBuffer())
        let minU = Infinity
        let maxU = -Infinity
        let minV = Infinity
        let maxV = -Infinity
        let hasVisibleCorner = false

        for (let cornerIndex = 0; cornerIndex < this.cuboidCorners.length; cornerIndex++) {
          const point = buffer.points[cornerIndex]
          const isVisible = projectWorldPoint(
            this.cuboidCorners[cornerIndex],
            channelState.worldToCamera,
            camera,
            point,
            this.scratch
          )
          buffer.cuboid.points[cornerIndex] = isVisible ? point : null
          if (!isVisible) continue
          hasVisibleCorner = true
          minU = Math.min(minU, point.u)
          maxU = Math.max(maxU, point.u)
          minV = Math.min(minV, point.v)
          maxV = Math.max(maxV, point.v)
        }
        if (!hasVisibleCorner) continue

        const projectedCuboid = buffer.cuboid
        projectedCuboid.trackId = trackId
        projectedCuboid.classId = classId
        projectedCuboid.color = color.color
        projectedCuboid.strokeOpacity = color.strokeOpacity
        projectedCuboid.depth = this.projectedCenter.depth
        projectedCuboid.bounds.minU = minU
        projectedCuboid.bounds.maxU = maxU
        projectedCuboid.bounds.minV = minV
        projectedCuboid.bounds.maxV = maxV
        channelState.projectedCuboids.push(projectedCuboid)
      }
    }

    return this.projectionFrame
  }
}
