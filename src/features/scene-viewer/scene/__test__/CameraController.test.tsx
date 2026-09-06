// @vitest-environment jsdom
import { createRequire } from 'node:module'
import type { ComponentProps, ElementRef } from 'react'
import { act, cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import * as THREE from 'three'
import type { OrbitControls } from '@react-three/drei'
import { SceneCtx } from '../../context'
import { createSceneStore } from '../../store/sceneStore'
import type { CameraMode } from '../../store/sceneStore'
import { CameraController } from '../CameraController'

type Controls = ElementRef<typeof OrbitControls>
type ControlsProps = ComponentProps<typeof OrbitControls>
const loop = vi.hoisted(() => ({
  frame: (_state: unknown, _delta: number) => {},
  controls: null as Controls | null
}))

vi.mock('@react-three/fiber', () => ({
  useFrame: (frame: typeof loop.frame) => {
    loop.frame = frame
  }
}))

// Keep the real OrbitControls math and limits; replace only the R3F mount.
vi.mock('@react-three/drei', async () => {
  const { forwardRef, useEffect, useImperativeHandle } = await import('react')
  return {
    OrbitControls: forwardRef<Controls, ControlsProps>((props, ref) => {
      const controls = loop.controls
      if (!controls) throw new Error('Camera test controls are not initialized')
      useImperativeHandle(ref, () => controls, [controls])
      Object.assign(controls, {
        enableDamping: props.enableDamping ?? true,
        enableRotate: props.enableRotate,
        enableZoom: props.enableZoom,
        enablePan: props.enablePan,
        minDistance: props.minDistance,
        maxDistance: props.maxDistance,
        minPolarAngle: props.minPolarAngle,
        maxPolarAngle: props.maxPolarAngle
      })
      const { onStart, onChange, onEnd } = props
      useEffect(() => {
        const handleStart = () => onStart?.({ type: 'start', target: controls })
        const handleChange = () => onChange?.({ type: 'change', target: controls })
        const handleEnd = () => onEnd?.({ type: 'end', target: controls })
        controls.addEventListener('start', handleStart)
        controls.addEventListener('change', handleChange)
        controls.addEventListener('end', handleEnd)
        return () => {
          controls.removeEventListener('start', handleStart)
          controls.removeEventListener('change', handleChange)
          controls.removeEventListener('end', handleEnd)
        }
      }, [controls, onStart, onChange, onEnd])
      return null
    })
  }
})

const require = createRequire(import.meta.url)
const dreiRequire = createRequire(require.resolve('@react-three/drei'))
const { OrbitControls: OrbitControlsImpl } = dreiRequire('three-stdlib') as {
  OrbitControls: new (camera: THREE.PerspectiveCamera) => Controls
}

function setup(mode: CameraMode = 'follow') {
  const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 1000)
  camera.up.set(0, 0, 1)
  camera.position.set(0, -50, 80)
  const controls = new OrbitControlsImpl(camera)
  loop.controls = controls
  const store = createSceneStore()
  store.setState({
    cameraMode: mode,
    egoPose: { translation: [715, 1810, 0], rotation: [1, 0, 0, 0] }
  })
  render(
    <SceneCtx.Provider value={{ store }}>
      <CameraController />
    </SceneCtx.Provider>
  )
  const step = (frames = 1) => {
    for (let i = 0; i < frames; i++) {
      act(() => {
        // Drei updates enabled controls at priority -1 before the controller.
        if (controls.enabled) controls.update()
        loop.frame({}, 1 / 60)
      })
    }
  }
  const switchMode = (next: CameraMode) => act(() => store.getState().setCameraMode(next))
  step()
  return { camera, controls, store, step, switchMode }
}

afterEach(() => {
  cleanup()
  loop.controls?.dispose()
})

describe('CameraController transitions', () => {
  it('does not roll abruptly when a top-view transition finishes', () => {
    const { camera, step, switchMode } = setup()
    switchMode('bev')
    let largestAngle = 0
    for (let i = 0; i < 30; i++) {
      const before = camera.quaternion.clone()
      step()
      largestAngle = Math.max(largestAngle, before.angleTo(camera.quaternion))
    }
    expect(largestAngle).toBeLessThan(0.2)
    expect(camera.up.toArray()).toEqual([0, 0, 1])
  })

  it('hands the current pose to free mode without moving or rotating it', () => {
    const { camera, controls, step, switchMode } = setup()
    switchMode('bev')
    step(30)
    const position = camera.position.clone()
    const orientation = camera.quaternion.clone()
    const target = controls.target.clone()
    switchMode('free')
    step(30)
    expect(camera.position.distanceTo(position)).toBeLessThan(0.001)
    expect(camera.quaternion.angleTo(orientation)).toBeLessThan(0.001)
    expect(controls.target.distanceTo(target)).toBeLessThan(0.001)
  })

  it('keeps a moving ego continuous when the transition hands off to follow', () => {
    const { camera, store, step, switchMode } = setup()
    switchMode('bev')
    step(30)
    switchMode('follow')
    for (let i = 1; i <= 25; i++) {
      store.setState({ egoPose: { translation: [715 + i, 1810, 0], rotation: [1, 0, 0, 0] } })
      step()
    }
    const before = camera.position.clone()
    store.setState({ egoPose: { translation: [741, 1810, 0], rotation: [1, 0, 0, 0] } })
    step()
    expect(camera.position.distanceTo(before)).toBeLessThan(2)
  })

  it('initializes a world-coordinate scene even when starting in free mode', () => {
    const { camera, controls } = setup('free')
    expect(controls.target.distanceTo(new THREE.Vector3(715, 1810, 0))).toBeLessThan(0.001)
    expect(camera.position.distanceTo(controls.target)).toBeLessThanOrEqual(controls.maxDistance)
  })

  it('cancels a transition when a gesture takes over, without pulling the camera back', () => {
    const { camera, controls, store, step, switchMode } = setup()
    switchMode('bev')
    step(10)
    expect(controls.enableRotate).toBe(true)
    act(() => {
      controls.dispatchEvent({ type: 'start', target: controls })
      camera.position.add(new THREE.Vector3(10, 5, 0))
      controls.update()
      controls.dispatchEvent({ type: 'end', target: controls })
    })
    expect(store.getState().cameraMode).toBe('free')
    const position = camera.position.clone()
    step(40)
    expect(camera.position.distanceTo(position)).toBeLessThan(0.001)
  })

  it('allows a gesture to take over before the first transition frame', () => {
    const { camera, controls, store, step, switchMode } = setup()
    switchMode('bev')
    act(() => {
      controls.dispatchEvent({ type: 'start', target: controls })
      camera.position.x += 1
      controls.update()
      controls.dispatchEvent({ type: 'end', target: controls })
    })
    const position = camera.position.clone()
    step(30)
    expect(store.getState().cameraMode).toBe('free')
    expect(camera.position.distanceTo(position)).toBeLessThan(0.001)
  })

  it('starts rapid mode changes from the current visible pose', () => {
    const { camera, step, switchMode } = setup()
    for (const mode of ['bev', 'follow', 'bev', 'free', 'follow'] as const) {
      switchMode(mode)
      const position = camera.position.clone()
      const orientation = camera.quaternion.clone()
      step()
      expect(camera.position.distanceTo(position)).toBeLessThan(1)
      expect(camera.quaternion.angleTo(orientation)).toBeLessThan(0.1)
      step(6)
    }
    step(30)
    expect(camera.up.toArray()).toEqual([0, 0, 1])
  })

  it('does not leave follow mode for a click while the vehicle keeps moving', () => {
    const { controls, store, step } = setup()
    act(() => controls.dispatchEvent({ type: 'start', target: controls }))
    store.setState({ egoPose: { translation: [716, 1810, 0], rotation: [1, 0, 0, 0] } })
    step(5)
    act(() => controls.dispatchEvent({ type: 'end', target: controls }))
    step()
    expect(store.getState().cameraMode).toBe('follow')
  })

  it('does not reverse the turn when a moving heading crosses the angle wrap', () => {
    const { camera, store, step, switchMode } = setup('bev')
    const setHeading = (degrees: number) => {
      const q = new THREE.Quaternion().setFromAxisAngle(
        new THREE.Vector3(0, 0, 1),
        THREE.MathUtils.degToRad(degrees)
      )
      store.setState({ egoPose: { translation: [715, 1810, 0], rotation: [q.w, q.x, q.y, q.z] } })
    }
    setHeading(-89)
    switchMode('follow')
    step(12)
    const orientation = camera.quaternion.clone()
    setHeading(-91)
    step()
    expect(camera.quaternion.angleTo(orientation)).toBeLessThan(0.3)
  })

  it('clears drag inertia and keeps the completed top view within its distance limit', () => {
    const { camera, controls, step, switchMode } = setup('free')
    controls.setAzimuthalAngle(controls.getAzimuthalAngle() + 0.8)
    switchMode('bev')
    step(30)
    const orientation = camera.quaternion.clone()
    const position = camera.position.clone()
    expect(camera.position.distanceTo(controls.target)).toBeCloseTo(150)
    expect(controls.enableRotate).toBe(false)
    step(30)
    expect(camera.quaternion.angleTo(orientation)).toBeLessThan(0.001)
    expect(camera.position.distanceTo(position)).toBeLessThan(0.001)
  })
})
