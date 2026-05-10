import { useRef, useMemo } from 'react'
import * as THREE from 'three'
import { useFrame } from '@react-three/fiber'
import { Html } from '@react-three/drei'
import { useSceneStore, useSceneStoreApi } from '../context'
import { getObjectColor } from '../utils/objectColors'
import type { CuboidPayload } from '../types'
import styles from './SelectedObjectIcon.module.css'

const CUBOID_STREAM = '/gt/objects/bounds'

// Simple 16×16 stroke-based icons per class id.
const CATEGORY_ICONS: Record<number, string> = {
  0:  'M8 5a2.5 2.5 0 0 1 2.5 2.5A2.5 2.5 0 0 1 8 10M8 12v1',                            // unknown
  1:  'M2 6h12v4H2zm3 0-3 4m4-4-3 4m4-4-3 4m4-4-3 4',                                    // barrier: diagonal stripes
  2:  'M4.5 12.5a2 2 0 1 0 .01 0m7 0a2 2 0 1 0 .01 0M4.5 12.5 8 7.5l3.5 5M8 7.5V4.5l2.5-1', // bicycle
  3:  'M2 4h12v9H2zm3 0v4m4-4v4m3-4v4M2 8h12M5 13v1.5m6-1.5v1.5',                        // bus
  4:  'M5 3.5h6l2 3v4.5l-1 2H4l-1-2V6.5zm-1 7v2m8-2v2',                                  // car
  5:  'M2 7h7v5.5H2zm9 1.5 3.5 1.5-3.5 1.5M5 7V4.5h3.5V7',                               // construction
  6:  'M4.5 12a2 2 0 1 0 .01 0m7 0a2 2 0 1 0 .01 0M4.5 12 8 7h3.5m-1.5 0V4l2.5-1',       // motorcycle
  7:  'M8 3.5a1.5 1.5 0 1 0 .01 0M8 6.5V11m-1.5-2.5h3m-2 2.5-1 3m2-3 1 3',               // pedestrian
  8:  'M8 2 14 13H2zm-3 7.5h6',                                                             // cone
  9:  'M2 6h10v6.5H2zm10 3h3M4 12.5V14m4.5-1.5V14',                                       // trailer
  10: 'M2 6h8v6.5H2zm8 2h3.5l1 2v2.5H10zm-5.5 4v1.5m3-1.5v1.5m4-2v1.5',                 // truck
}

interface IconInnerProps {
  trackId: number
  classId: number
  color: string
}

function IconInner({ trackId, classId, color }: IconInnerProps) {
  const store    = useSceneStoreApi()
  const groupRef = useRef<THREE.Group>(null)
  const iconPath = CATEGORY_ICONS[classId] ?? CATEGORY_ICONS[0]

  useFrame(() => {
    const group = groupRef.current
    if (!group) return
    const payload = store.getState().streamState[CUBOID_STREAM] as CuboidPayload | undefined
    if (!payload || payload.type !== 'cuboid') return

    for (let i = 0; i < payload.count; i++) {
      const tid = payload.trackIds ? payload.trackIds[i] : i
      if (tid !== trackId) continue
      const height = payload.sizes[i * 3 + 2]
      group.position.set(
        payload.centers[i * 3],
        payload.centers[i * 3 + 1],
        payload.centers[i * 3 + 2] + height / 2 + 2.0,
      )
      break
    }
  })

  return (
    <group ref={groupRef}>
      <Html center distanceFactor={60} zIndexRange={[20, 0]}>
        <div className={styles.icon}>
          <svg
            viewBox="0 0 16 16"
            width="18"
            height="18"
            fill="none"
            stroke={color}
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            className={styles.svgIcon}
          >
            <path d={iconPath} />
          </svg>
        </div>
        <div className={styles.arrow} />
      </Html>
    </group>
  )
}

export function SelectedObjectIcon() {
  const store          = useSceneStoreApi()
  const selectedTrackId = useSceneStore((s) => s.selectedTrackId)

  const iconInfo = useMemo(() => {
    if (selectedTrackId == null) return null
    const payload = store.getState().streamState[CUBOID_STREAM] as CuboidPayload | undefined
    if (!payload || payload.type !== 'cuboid') return null

    for (let i = 0; i < payload.count; i++) {
      const tid = payload.trackIds ? payload.trackIds[i] : i
      if (tid !== selectedTrackId) continue
      const classId = payload.classIds[i]
      const { color } = getObjectColor(classId)
      return { classId, color }
    }
    return null
  }, [selectedTrackId, store])

  if (selectedTrackId == null || !iconInfo) return null

  return (
    <IconInner
      key={selectedTrackId}
      trackId={selectedTrackId}
      classId={iconInfo.classId}
      color={iconInfo.color}
    />
  )
}
