import { useMemo } from 'react'
import * as THREE from 'three'
import { useSceneStore } from '../context'
import { getObjectColor } from '../utils/objectColors'
import {
  buildWorldToCameraMatrix,
  getBoxCornersInto,
  projectWorldToImageWithMatrix,
} from '../lib/camera/projection'
import type { ChannelProjectedBoxes, ProjectedBox3DWireframe } from '../lib/camera/types'
import type { CuboidPayload } from '../types'

const CAMERA_CHANNELS = [
  'CAM_FRONT',
  'CAM_FRONT_LEFT',
  'CAM_FRONT_RIGHT',
  'CAM_BACK',
  'CAM_BACK_LEFT',
  'CAM_BACK_RIGHT',
]

const EMPTY: ChannelProjectedBoxes = Object.fromEntries(
  CAMERA_CHANNELS.map((ch) => [ch, [] as ProjectedBox3DWireframe[]]),
)

const _centerVec = new THREE.Vector3()
const _boxCorners = Array.from({ length: 8 }, () => new THREE.Vector3())
const _cameraMatrices = new Map<string, THREE.Matrix4>()
const _cornerBuf: Array<ReturnType<typeof projectWorldToImageWithMatrix>> = new Array(8).fill(null)

export function useCameraProjectedBoxes(cuboidStreamName = '/gt/objects/bounds'): ChannelProjectedBoxes {
  const cuboidPayload = useSceneStore((s) => s.streamState[cuboidStreamName] as CuboidPayload | undefined)
  const egoPose = useSceneStore((s) => s.egoPose)
  const cameras = useSceneStore((s) => s.cameras)

  return useMemo(() => {
    if (!egoPose) return EMPTY
    if (!cuboidPayload || cuboidPayload.type !== 'cuboid') return EMPTY

    const cuboids = cuboidPayload

    _cameraMatrices.clear()
    for (const channel of CAMERA_CHANNELS) {
      const camInfo = cameras[channel]
      if (!camInfo) continue
      _cameraMatrices.set(channel, buildWorldToCameraMatrix(egoPose, camInfo))
    }

    const result: ChannelProjectedBoxes = Object.fromEntries(
      CAMERA_CHANNELS.map((ch) => [ch, [] as ProjectedBox3DWireframe[]]),
    )

    for (let i = 0; i < cuboids.count; i++) {
      const center: [number, number, number] = [
        cuboids.centers[i * 3],
        cuboids.centers[i * 3 + 1],
        cuboids.centers[i * 3 + 2],
      ]
      const size: [number, number, number] = [
        cuboids.sizes[i * 3],
        cuboids.sizes[i * 3 + 1],
        cuboids.sizes[i * 3 + 2],
      ]
      const rotation: [number, number, number, number] = [
        cuboids.rotations[i * 4],
        cuboids.rotations[i * 4 + 1],
        cuboids.rotations[i * 4 + 2],
        cuboids.rotations[i * 4 + 3],
      ]
      const classId = cuboids.classIds[i]
      const trackId = cuboids.trackIds ? cuboids.trackIds[i] : i

      _centerVec.set(center[0], center[1], center[2])
      getBoxCornersInto(center, size, rotation, _boxCorners)

      const { color, strokeOpacity } = getObjectColor(classId)

      for (const channel of CAMERA_CHANNELS) {
        const camInfo = cameras[channel]
        if (!camInfo) continue
        const worldToCamera = _cameraMatrices.get(channel)
        if (!worldToCamera) continue

        const centerProj = projectWorldToImageWithMatrix(_centerVec, worldToCamera, camInfo)
        if (!centerProj) continue

        let hasVisible = false
        for (let c = 0; c < 8; c++) {
          const p = projectWorldToImageWithMatrix(_boxCorners[c], worldToCamera, camInfo)
          _cornerBuf[c] = p
          if (p) hasVisible = true
        }
        if (!hasVisible) continue

        result[channel].push({
          trackId,
          classId,
          color,
          strokeOpacity,
          depth: centerProj.depth,
          points: [..._cornerBuf],
        })
      }
    }

    return result
  }, [cuboidPayload, egoPose, cameras])
}
