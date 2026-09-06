import { useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { useFrame, useThree } from '@react-three/fiber'
import { Html, useGLTF } from '@react-three/drei'
import {
  Bike,
  Bus,
  Car,
  CircleQuestionMark,
  Construction,
  createLucideIcon,
  Motorbike,
  PersonStanding,
  TrafficCone,
  Truck,
  type LucideIcon
} from 'lucide-react'
import { useSceneStore, useSceneStoreApi } from '../context'
import { advancePlaybackTime } from '../playback/timeManager'
import { getObjectColor } from '../styleConfig'
import type { CuboidPayload } from '../types'
import { CameraController } from './CameraController'

const EGO_MODEL_URL = '/ego.glb'
const EGO_RENDER_ORDER = 90
const EGO_MODEL_FORWARD_OFFSET_M = 0.9
const CUBOID_STREAM = '/gt/objects/bounds'

const MODEL_TO_EGO_QUATERNION = new THREE.Quaternion().setFromEuler(
  new THREE.Euler(-Math.PI / 2, 0, Math.PI, 'XYZ')
)

// Domain silhouettes use the same 24px grid and stroke as the library icons.
const ConstructionVehicle = createLucideIcon('ConstructionVehicle', [
  ['rect', { x: '2', y: '17', width: '13', height: '4', rx: '2', key: 'tracks' }],
  ['path', { d: 'M4 17V9h5l3 4v4M4 13h8M10 10l5-6 5 9', key: 'body' }],
  ['path', { d: 'm17 13 3-1 2 5h-5z', key: 'bucket' }]
])

const Trailer = createLucideIcon('Trailer', [
  ['rect', { x: '2', y: '5', width: '17', height: '11', rx: '1', key: 'body' }],
  ['path', { d: 'M19 16h3M16 16v4', key: 'hitch' }],
  ['circle', { cx: '6', cy: '18', r: '2', key: 'wheel-rear' }],
  ['circle', { cx: '11', cy: '18', r: '2', key: 'wheel-front' }]
])

const CATEGORY_ICONS: Record<number, { Icon: LucideIcon; label: string }> = {
  0: { Icon: CircleQuestionMark, label: 'Unknown object' },
  1: { Icon: Construction, label: 'Barrier' },
  2: { Icon: Bike, label: 'Bicycle' },
  3: { Icon: Bus, label: 'Bus' },
  4: { Icon: Car, label: 'Car' },
  5: { Icon: ConstructionVehicle, label: 'Construction vehicle' },
  6: { Icon: Motorbike, label: 'Motorcycle' },
  7: { Icon: PersonStanding, label: 'Pedestrian' },
  8: { Icon: TrafficCone, label: 'Traffic cone' },
  9: { Icon: Trailer, label: 'Trailer' },
  10: { Icon: Truck, label: 'Truck' }
}

function SceneEffects() {
  const { gl, scene, camera } = useThree()
  const store = useSceneStoreApi()
  const playbackTimeRef = useRef<number | null>(null)
  const lastRequestedFrameRef = useRef(-1)

  useEffect(() => {
    const raf = requestAnimationFrame(() => gl.compile(scene, camera))
    return () => cancelAnimationFrame(raf)
  }, [gl, scene, camera])

  useFrame((_state, delta) => {
    const { isPlaying, playbackSpeed, requestedFrameIndex, timestamps } = store.getState()
    if (!timestamps || timestamps.length === 0) {
      if (isPlaying) store.getState().pause()
      return
    }

    if (requestedFrameIndex !== lastRequestedFrameRef.current || playbackTimeRef.current === null) {
      playbackTimeRef.current = timestamps[requestedFrameIndex] ?? timestamps[0] ?? 0
      lastRequestedFrameRef.current = requestedFrameIndex
    }
    if (!isPlaying) return

    const result = advancePlaybackTime(playbackTimeRef.current, delta, playbackSpeed, timestamps)
    playbackTimeRef.current = result.timeSeconds

    if (result.targetFrameIndex !== requestedFrameIndex) {
      store.getState().requestFrame(result.targetFrameIndex)
      lastRequestedFrameRef.current = result.targetFrameIndex
    }
    if (!result.reachedEnd) return

    const finalFrameIndex = timestamps.length - 1
    if (store.getState().requestedFrameIndex !== finalFrameIndex) {
      store.getState().requestFrame(finalFrameIndex)
    }
    lastRequestedFrameRef.current = finalFrameIndex
    store.getState().pause()
  })

  return null
}

function prepareEgoScene(root: THREE.Object3D): THREE.Object3D {
  root.traverse(child => {
    child.frustumCulled = false
    child.renderOrder = EGO_RENDER_ORDER

    if (!(child instanceof THREE.Mesh)) return

    child.material = Array.isArray(child.material)
      ? child.material.map(material => material.clone())
      : child.material.clone()

    const materials = Array.isArray(child.material) ? child.material : [child.material]
    for (const material of materials) {
      material.color?.set('#ffffff')
      material.transparent = true
      material.opacity = 1
      material.depthTest = true
      material.depthWrite = true
      material.needsUpdate = true
    }
  })
  return root
}

function disposeEgoMaterials(root: THREE.Object3D): void {
  root.traverse(child => {
    if (!(child instanceof THREE.Mesh)) return
    const materials = Array.isArray(child.material) ? child.material : [child.material]
    materials.forEach(material => material.dispose())
  })
}

function EgoVehicle() {
  const store = useSceneStoreApi()
  const groupRef = useRef<THREE.Group>(null)
  const { scene } = useGLTF(EGO_MODEL_URL)
  const egoScene = useMemo(() => prepareEgoScene(scene.clone()), [scene])
  const scratch = useMemo(
    () => ({
      position: new THREE.Vector3(),
      quaternion: new THREE.Quaternion(),
      offset: new THREE.Vector3()
    }),
    []
  )

  useEffect(() => () => disposeEgoMaterials(egoScene), [egoScene])

  useFrame(() => {
    const group = groupRef.current
    const egoPose = store.getState().egoPose
    if (!group || !egoPose) return

    const { translation, rotation } = egoPose
    scratch.position.fromArray(translation)
    scratch.quaternion.set(rotation[1], rotation[2], rotation[3], rotation[0])
    scratch.offset.set(EGO_MODEL_FORWARD_OFFSET_M, 0, 0).applyQuaternion(scratch.quaternion)

    group.position.copy(scratch.position).add(scratch.offset)
    group.quaternion.copy(scratch.quaternion).multiply(MODEL_TO_EGO_QUATERNION)
  })

  return (
    <group ref={groupRef} frustumCulled={false} renderOrder={EGO_RENDER_ORDER}>
      <primitive object={egoScene} />
    </group>
  )
}

function SelectedTrackIcon({ trackId }: { trackId: number }) {
  const store = useSceneStoreApi()
  const groupRef = useRef<THREE.Group>(null)
  const markerRef = useRef<HTMLDivElement>(null)
  const classIdRef = useRef(0)
  const [classId, setClassId] = useState(0)
  const { Icon, label } = CATEGORY_ICONS[classId] ?? CATEGORY_ICONS[0]
  const { color } = getObjectColor(classId)

  useFrame(() => {
    const group = groupRef.current
    const marker = markerRef.current
    if (!group || !marker) return

    const payload = store.getState().streamState[CUBOID_STREAM] as CuboidPayload | undefined
    if (!payload || payload.type !== 'cuboid') {
      marker.style.visibility = 'hidden'
      return
    }

    let selectedIndex = -1
    for (let index = 0; index < payload.count; index++) {
      const currentTrackId = payload.trackIds?.[index] ?? index
      if (currentTrackId === trackId) {
        selectedIndex = index
        break
      }
    }

    if (selectedIndex < 0) {
      marker.style.visibility = 'hidden'
      return
    }

    const nextClassId = payload.classIds[selectedIndex]
    if (nextClassId !== classIdRef.current) {
      classIdRef.current = nextClassId
      setClassId(nextClassId)
    }

    const offset = selectedIndex * 3
    group.position.set(
      payload.centers[offset],
      payload.centers[offset + 1],
      payload.centers[offset + 2] + payload.sizes[offset + 2] / 2
    )
    // Html is a DOM overlay, so Three.js group visibility does not hide it.
    marker.style.visibility = 'visible'
  })

  return (
    <group ref={groupRef}>
      <Html zIndexRange={[20, 0]} style={{ pointerEvents: 'none' }}>
        <div
          ref={markerRef}
          role='img'
          aria-label={`Selected ${label.toLowerCase()}, track ${trackId}`}
          style={{ visibility: 'hidden' }}
          className='flex w-8 -translate-x-1/2 -translate-y-full flex-col items-center'
        >
          <div className='flex size-8 shrink-0 items-center justify-center rounded-md bg-app-panel-bg-solid shadow-[0_2px_6px_rgb(15_23_42/12%)]'>
            <Icon size={26} strokeWidth={2} color={color} aria-hidden='true' />
          </div>
          <div className='h-2.5 w-px bg-app-text-dim' aria-hidden='true' />
          <div className='size-1 shrink-0 rounded-full bg-app-text-muted' aria-hidden='true' />
        </div>
      </Html>
    </group>
  )
}

function SelectedObjectIcon() {
  const selectedTrackId = useSceneStore(state => state.selectedTrackId)
  return selectedTrackId == null ? null : (
    <SelectedTrackIcon key={selectedTrackId} trackId={selectedTrackId} />
  )
}

export function SceneContent() {
  return (
    <>
      <SceneEffects />
      <CameraController />
      <ambientLight intensity={0.5} />
      <EgoVehicle />
      <SelectedObjectIcon />
    </>
  )
}

useGLTF.preload(EGO_MODEL_URL)
