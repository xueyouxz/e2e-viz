import { useCallback, useRef, useState } from 'react'
import type { ElementRef } from 'react'
import * as THREE from 'three'
import { useFrame } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import { useSceneStore, useSceneStoreApi } from '../context'
import type { CameraMode } from '../store/sceneStore'

const TRANSITION_DURATION = 0.4
const FOLLOW_LAMBDA = 8
const FOLLOW_OFFSET = new THREE.Vector3(-18, 0, 15)
const TOP_VIEW_DISTANCE = 150
// Stay just off the pole so lookAt and orbit azimuth have a stable orientation.
const MIN_POLAR_ANGLE = 0.001

function createCameraControllerScratch() {
  return {
    egoPos: new THREE.Vector3(),
    prevEgoPos: new THREE.Vector3(),
    egoDelta: new THREE.Vector3(),
    quaternion: new THREE.Quaternion(),
    offset: new THREE.Vector3(),
    desiredCamPos: new THREE.Vector3(),
    targetLerp: new THREE.Vector3(),
    camLerp: new THREE.Vector3(),
    spherical: new THREE.Spherical()
  }
}

interface Transition {
  fromTarget: THREE.Vector3
  fromOrbit: THREE.Spherical
  toTheta?: number
  elapsed: number
}

// Convert Z-up world offsets to the Y-up coordinates used by Spherical.
function readOrbit(target: THREE.Spherical, offset: THREE.Vector3): THREE.Spherical {
  return target.setFromCartesianCoords(offset.x, offset.z, -offset.y)
}

export function CameraController() {
  const store = useSceneStoreApi()
  const [scratch] = useState(createCameraControllerScratch)
  const controlsRef = useRef<ElementRef<typeof OrbitControls> | null>(null)
  const prevModeRef = useRef<CameraMode>(store.getState().cameraMode)
  const initializedRef = useRef(false)
  const transitionRef = useRef<Transition | null>(null)
  const interactingRef = useRef(false)
  const updatingRef = useRef(false)

  const updateControls = useCallback((controls: ElementRef<typeof OrbitControls>) => {
    updatingRef.current = true
    try {
      controls.update()
    } finally {
      updatingRef.current = false
    }
  }, [])

  const handleControlChange = useCallback(() => {
    if (!interactingRef.current || updatingRef.current) return
    // A gesture takes over the current pose instead of fighting the animation.
    const mode = store.getState().cameraMode
    if (transitionRef.current || mode === 'follow' || mode !== prevModeRef.current) {
      transitionRef.current = null
      prevModeRef.current = 'free'
      if (controlsRef.current) controlsRef.current.enableDamping = true
      store.getState().setCameraMode('free')
    }
  }, [store])

  useFrame((_, delta) => {
    const { cameraMode, egoPose } = store.getState()
    const controls = controlsRef.current
    if (!controls || !egoPose) return

    const cam = controls.object
    const { translation, rotation } = egoPose
    scratch.egoPos.fromArray(translation)
    scratch.egoDelta.subVectors(scratch.egoPos, scratch.prevEgoPos)
    scratch.quaternion.set(rotation[1], rotation[2], rotation[3], rotation[0])

    if (cameraMode === 'bev') {
      scratch.offset.set(
        0,
        -TOP_VIEW_DISTANCE * Math.sin(MIN_POLAR_ANGLE),
        TOP_VIEW_DISTANCE * Math.cos(MIN_POLAR_ANGLE)
      )
    } else {
      scratch.offset.copy(FOLLOW_OFFSET).applyQuaternion(scratch.quaternion)
    }
    scratch.desiredCamPos.copy(scratch.egoPos).add(scratch.offset)

    if (!initializedRef.current) {
      cam.up.set(0, 0, 1)
      cam.position.copy(scratch.desiredCamPos)
      controls.target.copy(scratch.egoPos)
      scratch.camLerp.copy(cam.position)
      scratch.targetLerp.copy(controls.target)
      scratch.prevEgoPos.copy(scratch.egoPos)
      updateControls(controls)
      initializedRef.current = true
      prevModeRef.current = cameraMode
      return
    }

    if (cameraMode !== prevModeRef.current) {
      // Discard residual drag/pan damping without applying it to the new view.
      scratch.camLerp.copy(cam.position)
      scratch.targetLerp.copy(controls.target)
      controls.enableDamping = false
      updateControls(controls)
      cam.position.copy(scratch.camLerp)
      controls.target.copy(scratch.targetLerp)
      updateControls(controls)

      // Free mode inherits the visible pose, including an interrupted transition.
      transitionRef.current =
        cameraMode === 'free'
          ? null
          : {
              fromTarget: controls.target.clone(),
              fromOrbit: readOrbit(
                new THREE.Spherical(),
                scratch.offset.subVectors(cam.position, controls.target)
              ),
              elapsed: 0
            }
      prevModeRef.current = cameraMode
    }

    const tr = transitionRef.current
    controls.enableDamping = !tr && cameraMode !== 'follow'
    controls.enableRotate = cameraMode !== 'bev' || tr !== null
    if (tr) {
      tr.elapsed += delta
      const t = Math.min(tr.elapsed / TRANSITION_DURATION, 1)
      const alpha = t * t * (3 - 2 * t)
      const toOrbit = readOrbit(
        scratch.spherical,
        scratch.offset.subVectors(scratch.desiredCamPos, scratch.egoPos)
      )
      // Unwrap against the previous destination so a moving heading crossing
      // -PI/PI cannot reverse the interpolation through nearly a full turn.
      const previousTheta = tr.toTheta ?? tr.fromOrbit.theta
      tr.toTheta =
        previousTheta +
        THREE.MathUtils.euclideanModulo(toOrbit.theta - previousTheta + Math.PI, Math.PI * 2) -
        Math.PI
      toOrbit.set(
        THREE.MathUtils.lerp(tr.fromOrbit.radius, toOrbit.radius, alpha),
        THREE.MathUtils.lerp(tr.fromOrbit.phi, toOrbit.phi, alpha),
        THREE.MathUtils.lerp(tr.fromOrbit.theta, tr.toTheta, alpha)
      )
      scratch.offset.setFromSpherical(toOrbit)
      controls.target.lerpVectors(tr.fromTarget, scratch.egoPos, alpha)
      cam.position.set(scratch.offset.x, -scratch.offset.z, scratch.offset.y).add(controls.target)
      updateControls(controls)

      // Hand off exactly the rendered pose; no second initialization or snap.
      scratch.camLerp.copy(cam.position)
      scratch.targetLerp.copy(controls.target)
      if (t >= 1) transitionRef.current = null
    } else if (cameraMode === 'follow') {
      const alpha = 1 - Math.exp(-FOLLOW_LAMBDA * delta)
      scratch.targetLerp.lerp(scratch.egoPos, alpha)
      scratch.camLerp.lerp(scratch.desiredCamPos, alpha * 0.85)
      controls.target.copy(scratch.targetLerp)
      cam.position.copy(scratch.camLerp)
      updateControls(controls)
    } else if (cameraMode === 'bev') {
      cam.position.add(scratch.egoDelta)
      controls.target.add(scratch.egoDelta)
      updateControls(controls)
    }

    scratch.prevEgoPos.copy(scratch.egoPos)
  })

  const cameraMode = useSceneStore(s => s.cameraMode)

  return (
    <OrbitControls
      ref={controlsRef}
      onStart={() => {
        interactingRef.current = true
      }}
      onEnd={() => {
        interactingRef.current = false
      }}
      onChange={handleControlChange}
      enableRotate={cameraMode !== 'bev'}
      mouseButtons={{
        LEFT: cameraMode === 'bev' ? THREE.MOUSE.PAN : THREE.MOUSE.ROTATE,
        MIDDLE: THREE.MOUSE.DOLLY,
        RIGHT: THREE.MOUSE.PAN
      }}
      touches={{
        ONE: cameraMode === 'bev' ? THREE.TOUCH.PAN : THREE.TOUCH.ROTATE,
        TWO: THREE.TOUCH.DOLLY_PAN
      }}
      enableZoom
      enablePan={cameraMode !== 'follow'}
      makeDefault
      minDistance={3}
      maxDistance={200}
      minPolarAngle={MIN_POLAR_ANGLE}
      maxPolarAngle={Math.PI - MIN_POLAR_ANGLE}
    />
  )
}
