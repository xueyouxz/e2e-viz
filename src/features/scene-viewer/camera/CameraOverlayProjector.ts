import * as THREE from 'three'
import { getObjectColor } from '../styleConfig'
import type { CameraInfo, CuboidPayload, EgoPose } from '../types'
import {
  buildWorldToCameraMatrix,
  createProjectionScratch,
  getCuboidCornersInto,
  projectWorldToImageInto
} from './projection'
import { CAMERA_CHANNELS } from './types'
import type {
  CameraChannel,
  CameraOverlayFrame,
  ProjectedBox3DWireframe,
  ProjectedPoint2D
} from './types'

interface ProjectedCuboidSlot {
  projectedCuboid: ProjectedBox3DWireframe
  pointPool: ProjectedPoint2D[]
}

interface ChannelProjectionResources {
  worldToCamera: THREE.Matrix4
  projectedCuboids: ProjectedBox3DWireframe[]
  slots: ProjectedCuboidSlot[]
}

function createChannelResources(): ChannelProjectionResources {
  return {
    worldToCamera: new THREE.Matrix4(),
    projectedCuboids: [],
    slots: []
  }
}

function createProjectedCuboidSlot(): ProjectedCuboidSlot {
  const pointPool = Array.from({ length: 8 }, () => ({ u: 0, v: 0, depth: 0 }))
  return {
    pointPool,
    projectedCuboid: {
      trackId: 0,
      classId: 0,
      color: '#9CA3AF',
      strokeOpacity: 0.64,
      depth: 0,
      points: [...pointPool],
      bounds: { minU: 0, maxU: 0, minV: 0, maxV: 0 }
    }
  }
}

export class CameraOverlayProjector {
  private readonly projectionScratch = createProjectionScratch()
  private readonly scratchCenter = new THREE.Vector3()
  private readonly scratchCorners = Array.from({ length: 8 }, () => new THREE.Vector3())
  private readonly scratchCenterProjection: ProjectedPoint2D = { u: 0, v: 0, depth: 0 }
  private readonly channels: Record<CameraChannel, ChannelProjectionResources>
  private readonly frame: CameraOverlayFrame
  private previousCuboids: CuboidPayload | undefined
  private previousEgoPose: EgoPose | null = null
  private previousCameras: Record<string, CameraInfo> | undefined

  constructor() {
    this.channels = {
      CAM_FRONT: createChannelResources(),
      CAM_FRONT_LEFT: createChannelResources(),
      CAM_FRONT_RIGHT: createChannelResources(),
      CAM_BACK: createChannelResources(),
      CAM_BACK_LEFT: createChannelResources(),
      CAM_BACK_RIGHT: createChannelResources()
    }
    this.frame = {
      version: 0,
      projectedCuboids: Object.fromEntries(
        CAMERA_CHANNELS.map(channel => [channel, this.channels[channel].projectedCuboids])
      ) as Record<CameraChannel, ProjectedBox3DWireframe[]>
    }
  }

  projectFrame(
    cuboids: CuboidPayload | undefined,
    egoPose: EgoPose | null,
    cameras: Record<string, CameraInfo>
  ): CameraOverlayFrame {
    if (
      cuboids === this.previousCuboids &&
      egoPose === this.previousEgoPose &&
      cameras === this.previousCameras
    ) {
      return this.frame
    }

    this.previousCuboids = cuboids
    this.previousEgoPose = egoPose
    this.previousCameras = cameras
    this.frame.version++
    for (const channel of CAMERA_CHANNELS) {
      this.channels[channel].projectedCuboids.length = 0
    }

    if (!egoPose || !cuboids || cuboids.type !== 'cuboid') return this.frame

    for (const channel of CAMERA_CHANNELS) {
      const camera = cameras[channel]
      if (!camera) continue
      buildWorldToCameraMatrix(
        egoPose,
        camera,
        this.channels[channel].worldToCamera,
        this.projectionScratch
      )
    }

    for (let cuboidIndex = 0; cuboidIndex < cuboids.count; cuboidIndex++) {
      const centerOffset = cuboidIndex * 3
      this.scratchCenter.set(
        cuboids.centers[centerOffset],
        cuboids.centers[centerOffset + 1],
        cuboids.centers[centerOffset + 2]
      )
      getCuboidCornersInto(cuboids, cuboidIndex, this.scratchCorners, this.projectionScratch)
      const classId = cuboids.classIds[cuboidIndex]
      const trackId = cuboids.trackIds?.[cuboidIndex] ?? cuboidIndex
      const colorConfig = getObjectColor(classId)

      for (const channel of CAMERA_CHANNELS) {
        const camera = cameras[channel]
        if (!camera) continue
        const channelResources = this.channels[channel]
        if (
          !projectWorldToImageInto(
            this.scratchCenter,
            channelResources.worldToCamera,
            camera,
            this.scratchCenterProjection,
            this.projectionScratch
          )
        ) {
          continue
        }

        const slotIndex = channelResources.projectedCuboids.length
        const slot =
          channelResources.slots[slotIndex] ??
          (channelResources.slots[slotIndex] = createProjectedCuboidSlot())
        let minU = Infinity
        let maxU = -Infinity
        let minV = Infinity
        let maxV = -Infinity
        let hasVisibleCorner = false

        for (let cornerIndex = 0; cornerIndex < this.scratchCorners.length; cornerIndex++) {
          const point = slot.pointPool[cornerIndex]
          const visible = projectWorldToImageInto(
            this.scratchCorners[cornerIndex],
            channelResources.worldToCamera,
            camera,
            point,
            this.projectionScratch
          )
          slot.projectedCuboid.points[cornerIndex] = visible ? point : null
          if (!visible) continue
          hasVisibleCorner = true
          minU = Math.min(minU, point.u)
          maxU = Math.max(maxU, point.u)
          minV = Math.min(minV, point.v)
          maxV = Math.max(maxV, point.v)
        }
        if (!hasVisibleCorner) continue

        const projectedCuboid = slot.projectedCuboid
        projectedCuboid.trackId = trackId
        projectedCuboid.classId = classId
        projectedCuboid.color = colorConfig.color
        projectedCuboid.strokeOpacity = colorConfig.strokeOpacity
        projectedCuboid.depth = this.scratchCenterProjection.depth
        projectedCuboid.bounds.minU = minU
        projectedCuboid.bounds.maxU = maxU
        projectedCuboid.bounds.minV = minV
        projectedCuboid.bounds.maxV = maxV
        channelResources.projectedCuboids.push(projectedCuboid)
      }
    }

    return this.frame
  }
}
