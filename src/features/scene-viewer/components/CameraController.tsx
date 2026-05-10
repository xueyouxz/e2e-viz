import { useRef } from 'react'
import * as THREE from 'three'
import { useFrame } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import { useSceneStore, useSceneStoreApi } from '../context'
import type { CameraMode } from '../store/sceneStore'

// ─── Pre-allocated temporaries (no per-frame allocation) ─────────────────────
const _egoPos = new THREE.Vector3()
const _prevEgoPos = new THREE.Vector3()
const _q = new THREE.Quaternion()
const _followOffset = new THREE.Vector3(-18, 0, 15)
const _offset = new THREE.Vector3()
const _desiredCamPos = new THREE.Vector3()
const _targetLerp = new THREE.Vector3()
const _camLerp = new THREE.Vector3()
const _egoDelta = new THREE.Vector3()

const TRANSITION_DURATION = 0.4
const FOLLOW_LAMBDA = 8

interface Transition {
  fromPos: THREE.Vector3
  fromTarget: THREE.Vector3
  toPos: THREE.Vector3
  toTarget: THREE.Vector3
  elapsed: number
}

function wxyzToThreeQuat(wxyz: [number, number, number, number]): THREE.Quaternion {
  const [w, x, y, z] = wxyz
  return _q.set(x, y, z, w)
}

export function CameraController() {
  const store = useSceneStoreApi()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const controlsRef = useRef<any>(null)
  const prevModeRef = useRef<CameraMode>('follow')
  const snapRef = useRef(true)
  const bevInitRef = useRef(false)
  const transitionRef = useRef<Transition | null>(null)
  const prevEgoInitRef = useRef(false)

  useFrame((_, delta) => {
    const { cameraMode, egoPose } = store.getState()
    const controls = controlsRef.current
    if (!controls || !egoPose) return

    const { translation, rotation } = egoPose
    _egoPos.set(translation[0], translation[1], translation[2])

    if (!prevEgoInitRef.current) {
      _prevEgoPos.copy(_egoPos)
      _targetLerp.copy(_egoPos)
      _camLerp.copy(_egoPos).add(_followOffset)
      prevEgoInitRef.current = true
    }

    if (cameraMode !== prevModeRef.current) {
      const cam = controls.object as THREE.Camera
      const toPos = computeModeIdealCamPos(cameraMode, _egoPos, rotation)
      const toTarget = computeModeIdealTarget(cameraMode, _egoPos)

      transitionRef.current = {
        fromPos: cam.position.clone(),
        fromTarget: controls.target.clone(),
        toPos,
        toTarget,
        elapsed: 0,
      }

      if (cameraMode === 'follow') snapRef.current = true
      if (cameraMode === 'bev') bevInitRef.current = false
      prevModeRef.current = cameraMode
    }

    _egoDelta.subVectors(_egoPos, _prevEgoPos)

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
      _prevEgoPos.copy(_egoPos)
      return
    }

    if (cameraMode === 'follow') {
      wxyzToThreeQuat(rotation)
      _offset.copy(_followOffset).applyQuaternion(_q)
      _desiredCamPos.addVectors(_egoPos, _offset)

      if (snapRef.current) {
        _targetLerp.copy(_egoPos)
        _camLerp.copy(_desiredCamPos)
        ;(controls.object as THREE.Camera).up.set(0, 0, 1)
        snapRef.current = false
      } else {
        const alpha = 1 - Math.exp(-FOLLOW_LAMBDA * delta)
        _targetLerp.lerp(_egoPos, alpha)
        _camLerp.lerp(_desiredCamPos, alpha * 0.85)
      }

      controls.target.copy(_targetLerp)
      controls.object.position.copy(_camLerp)
      controls.update()
    } else if (cameraMode === 'bev') {
      if (!bevInitRef.current) {
        controls.object.position.set(_egoPos.x, _egoPos.y, 150)
        controls.target.set(_egoPos.x, _egoPos.y, 0)
        controls.object.up.set(0, 1, 0)
        bevInitRef.current = true
      } else {
        controls.object.position.addScaledVector(_egoDelta, 1)
        controls.target.addScaledVector(_egoDelta, 1)
      }
      controls.update()
    }
    // free mode: OrbitControls handles everything

    _prevEgoPos.copy(_egoPos)
  })

  const cameraMode = useSceneStore((s) => s.cameraMode)

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
  rotation: [number, number, number, number],
): THREE.Vector3 {
  if (mode === 'follow') {
    const [w, x, y, z] = rotation
    const q = new THREE.Quaternion(x, y, z, w)
    return new THREE.Vector3().copy(_followOffset).applyQuaternion(q).add(egoPos)
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
