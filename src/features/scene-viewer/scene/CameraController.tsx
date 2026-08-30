import { useRef, useState } from 'react'
import type { ElementRef } from 'react'
import * as THREE from 'three'
import { useFrame } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import { useSceneStore, useSceneStoreApi } from '../context'
import type { CameraMode } from '../store/sceneStore'

const TRANSITION_DURATION = 0.4
const FOLLOW_LAMBDA = 8
const FOLLOW_OFFSET = new THREE.Vector3(-18, 0, 15)

interface CameraControllerScratch {
  egoPos: THREE.Vector3
  prevEgoPos: THREE.Vector3
  quaternion: THREE.Quaternion
  offset: THREE.Vector3
  desiredCamPos: THREE.Vector3
  targetLerp: THREE.Vector3
  camLerp: THREE.Vector3
  egoDelta: THREE.Vector3
}

function createCameraControllerScratch(): CameraControllerScratch {
  return {
    egoPos: new THREE.Vector3(),
    prevEgoPos: new THREE.Vector3(),
    quaternion: new THREE.Quaternion(),
    offset: new THREE.Vector3(),
    desiredCamPos: new THREE.Vector3(),
    targetLerp: new THREE.Vector3(),
    camLerp: new THREE.Vector3(),
    egoDelta: new THREE.Vector3()
  }
}

interface Transition {
  fromPos: THREE.Vector3
  fromTarget: THREE.Vector3
  toPos: THREE.Vector3
  toTarget: THREE.Vector3
  elapsed: number
}

function setQuaternionFromWxyz(
  target: THREE.Quaternion,
  wxyz: [number, number, number, number]
): void {
  const [w, x, y, z] = wxyz
  target.set(x, y, z, w)
}

export function CameraController() {
  const store = useSceneStoreApi()
  const [scratch] = useState(createCameraControllerScratch)
  const controlsRef = useRef<ElementRef<typeof OrbitControls> | null>(null)
  const prevModeRef = useRef<CameraMode>(store.getState().cameraMode)
  const snapRef = useRef(true)
  const bevInitRef = useRef(false)
  const transitionRef = useRef<Transition | null>(null)
  const prevEgoInitRef = useRef(false)

  useFrame((_, delta) => {
    const { cameraMode, egoPose } = store.getState()
    const controls = controlsRef.current
    if (!controls || !egoPose) return

    const { translation, rotation } = egoPose
    scratch.egoPos.set(translation[0], translation[1], translation[2])

    if (!prevEgoInitRef.current) {
      scratch.prevEgoPos.copy(scratch.egoPos)
      scratch.targetLerp.copy(scratch.egoPos)
      scratch.camLerp.copy(scratch.egoPos).add(FOLLOW_OFFSET)
      prevEgoInitRef.current = true
    }

    if (cameraMode !== prevModeRef.current) {
      const cam = controls.object as THREE.Camera
      const toPos = computeModeIdealCamPos(cameraMode, scratch.egoPos, rotation)
      const toTarget = computeModeIdealTarget(cameraMode, scratch.egoPos)

      transitionRef.current = {
        fromPos: cam.position.clone(),
        fromTarget: controls.target.clone(),
        toPos,
        toTarget,
        elapsed: 0
      }

      if (cameraMode === 'follow') snapRef.current = true
      if (cameraMode === 'bev') bevInitRef.current = false
      prevModeRef.current = cameraMode
    }

    scratch.egoDelta.subVectors(scratch.egoPos, scratch.prevEgoPos)

    const tr = transitionRef.current
    if (tr) {
      tr.elapsed += delta
      const t = Math.min(tr.elapsed / TRANSITION_DURATION, 1)
      const alpha = t * t * (3 - 2 * t) // smoothstep

      const cam = controls.object as THREE.Camera
      cam.position.lerpVectors(tr.fromPos, tr.toPos, alpha)
      controls.target.lerpVectors(tr.fromTarget, tr.toTarget, alpha)
      controls.update()

      if (t >= 1) transitionRef.current = null
      scratch.prevEgoPos.copy(scratch.egoPos)
      return
    }

    if (cameraMode === 'follow') {
      setQuaternionFromWxyz(scratch.quaternion, rotation)
      scratch.offset.copy(FOLLOW_OFFSET).applyQuaternion(scratch.quaternion)
      scratch.desiredCamPos.addVectors(scratch.egoPos, scratch.offset)

      if (snapRef.current) {
        scratch.targetLerp.copy(scratch.egoPos)
        scratch.camLerp.copy(scratch.desiredCamPos)
        ;(controls.object as THREE.Camera).up.set(0, 0, 1)
        snapRef.current = false
      } else {
        const alpha = 1 - Math.exp(-FOLLOW_LAMBDA * delta)
        scratch.targetLerp.lerp(scratch.egoPos, alpha)
        scratch.camLerp.lerp(scratch.desiredCamPos, alpha * 0.85)
      }

      controls.target.copy(scratch.targetLerp)
      controls.object.position.copy(scratch.camLerp)
      controls.update()
    } else if (cameraMode === 'bev') {
      if (!bevInitRef.current) {
        controls.object.position.set(scratch.egoPos.x, scratch.egoPos.y, 150)
        controls.target.set(scratch.egoPos.x, scratch.egoPos.y, 0)
        controls.object.up.set(0, 1, 0)
        bevInitRef.current = true
      } else {
        controls.object.position.addScaledVector(scratch.egoDelta, 1)
        controls.target.addScaledVector(scratch.egoDelta, 1)
      }
      controls.update()
    }
    // free mode: OrbitControls handles everything

    scratch.prevEgoPos.copy(scratch.egoPos)
  })

  const cameraMode = useSceneStore(s => s.cameraMode)

  return (
    <OrbitControls
      ref={controlsRef}
      enableRotate={cameraMode !== 'bev'}
      enableZoom
      enablePan={cameraMode !== 'follow'}
      makeDefault
      minDistance={3}
      maxDistance={100}
      minPolarAngle={0}
      maxPolarAngle={cameraMode === 'bev' ? Math.PI / 2 : Math.PI}
    />
  )
}

function computeModeIdealCamPos(
  mode: CameraMode,
  egoPos: THREE.Vector3,
  rotation: [number, number, number, number]
): THREE.Vector3 {
  if (mode === 'follow') {
    const [w, x, y, z] = rotation
    const q = new THREE.Quaternion(x, y, z, w)
    return new THREE.Vector3().copy(FOLLOW_OFFSET).applyQuaternion(q).add(egoPos)
  }
  if (mode === 'bev') {
    return new THREE.Vector3(egoPos.x, egoPos.y, 150)
  }
  return new THREE.Vector3(egoPos.x - 18, egoPos.y, egoPos.z + 15)
}

function computeModeIdealTarget(mode: CameraMode, egoPos: THREE.Vector3): THREE.Vector3 {
  if (mode === 'bev') return new THREE.Vector3(egoPos.x, egoPos.y, 0)
  return new THREE.Vector3(egoPos.x, egoPos.y, egoPos.z)
}
