import { useCallback, useMemo } from 'react'
import { useSceneStore } from '../context'
import { useCameraProjectedBoxes } from '../hooks/useCameraProjectedBoxes'
import { CameraOverlayCanvas } from '../layer/CameraOverlayCanvas'
import type { ImagePayload } from '../types'
import type { ProjectedBox3DWireframe, ProjectedPoint2D } from '../lib/camera/types'
import styles from './CameraPanel.module.css'

const CAMERA_ROWS = [
  ['CAM_FRONT_LEFT', 'CAM_FRONT', 'CAM_FRONT_RIGHT'],
  ['CAM_BACK_LEFT', 'CAM_BACK', 'CAM_BACK_RIGHT'],
] as const

function hitTestBoxes(
  clickX: number,
  clickY: number,
  containerW: number,
  containerH: number,
  srcW: number,
  srcH: number,
  boxes: ProjectedBox3DWireframe[],
): number | null {
  const scale = Math.max(containerW / srcW, containerH / srcH)
  const offsetX = (containerW - srcW * scale) / 2
  const offsetY = (containerH - srcH * scale) / 2
  const imgX = (clickX - offsetX) / scale
  const imgY = (clickY - offsetY) / scale

  let bestTrackId: number | null = null
  let bestArea = Infinity

  for (const box of boxes) {
    const pts = box.points.filter((p): p is ProjectedPoint2D => p !== null)
    if (pts.length === 0) continue

    let minU = Infinity, maxU = -Infinity, minV = Infinity, maxV = -Infinity
    for (const p of pts) {
      if (p.u < minU) minU = p.u
      if (p.u > maxU) maxU = p.u
      if (p.v < minV) minV = p.v
      if (p.v > maxV) maxV = p.v
    }

    const margin = 12
    if (
      imgX >= minU - margin && imgX <= maxU + margin &&
      imgY >= minV - margin && imgY <= maxV + margin
    ) {
      const area = (maxU - minU) * (maxV - minV)
      if (area < bestArea) {
        bestArea = area
        bestTrackId = box.trackId
      }
    }
  }

  return bestTrackId
}

export function CameraPanel() {
  // Subscribe per-channel instead of the entire streamState to avoid re-renders
  // when non-camera streams update.
  const camFront      = useSceneStore((s) => s.streamState['/camera/CAM_FRONT']       as ImagePayload | undefined)
  const camFrontLeft  = useSceneStore((s) => s.streamState['/camera/CAM_FRONT_LEFT']  as ImagePayload | undefined)
  const camFrontRight = useSceneStore((s) => s.streamState['/camera/CAM_FRONT_RIGHT'] as ImagePayload | undefined)
  const camBack       = useSceneStore((s) => s.streamState['/camera/CAM_BACK']        as ImagePayload | undefined)
  const camBackLeft   = useSceneStore((s) => s.streamState['/camera/CAM_BACK_LEFT']   as ImagePayload | undefined)
  const camBackRight  = useSceneStore((s) => s.streamState['/camera/CAM_BACK_RIGHT']  as ImagePayload | undefined)

  const cameras         = useSceneStore((s) => s.cameras)
  const selectedTrackId = useSceneStore((s) => s.selectedTrackId)
  const setSelectedTrackId = useSceneStore((s) => s.setSelectedTrackId)
  const projectedBoxes  = useCameraProjectedBoxes()

  const cameraImages = useMemo<Record<string, ImagePayload | undefined>>(() => ({
    CAM_FRONT:       camFront,
    CAM_FRONT_LEFT:  camFrontLeft,
    CAM_FRONT_RIGHT: camFrontRight,
    CAM_BACK:        camBack,
    CAM_BACK_LEFT:   camBackLeft,
    CAM_BACK_RIGHT:  camBackRight,
  }), [camFront, camFrontLeft, camFrontRight, camBack, camBackLeft, camBackRight])

  const handleClick = useCallback((
    e: React.MouseEvent<HTMLDivElement>,
    srcW: number,
    srcH: number,
    boxes: ProjectedBox3DWireframe[],
  ) => {
    const rect = e.currentTarget.getBoundingClientRect()
    const hit = hitTestBoxes(
      e.clientX - rect.left, e.clientY - rect.top,
      rect.width, rect.height, srcW, srcH, boxes,
    )
    setSelectedTrackId(hit)
  }, [setSelectedTrackId])

  return (
    <div className={styles.panel}>
      <div className={styles.grid}>
        {CAMERA_ROWS.map((row) => (
          <div key={row.join('-')} className={styles.row}>
            {row.map((channel) => {
              const imagePayload = cameraImages[channel]
              const camInfo = cameras[channel]
              const sourceWidth = camInfo?.image_width ?? 1600
              const sourceHeight = camInfo?.image_height ?? 900
              const boxes = projectedBoxes[channel] ?? []

              return (
                <div key={channel} className={styles.cell}>
                  {imagePayload?.url ? (
                    <div
                      className={styles.mediaWrap}
                      onClick={(e) => handleClick(e, sourceWidth, sourceHeight, boxes)}
                      style={{ cursor: 'crosshair' }}
                    >
                      <img
                        src={imagePayload.url}
                        alt={channel}
                        className={styles.thumb}
                        draggable={false}
                      />
                      <CameraOverlayCanvas
                        boxes={boxes}
                        sourceWidth={sourceWidth}
                        sourceHeight={sourceHeight}
                        fitMode="cover"
                        className={styles.overlayCanvas}
                        selectedTrackId={selectedTrackId}
                      />
                    </div>
                  ) : (
                    <div className={styles.placeholder} />
                  )}
                </div>
              )
            })}
          </div>
        ))}
      </div>
    </div>
  )
}
