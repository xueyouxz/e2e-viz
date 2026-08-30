import { useLayoutEffect } from 'react'
import * as THREE from 'three'
import { useThree } from '@react-three/fiber'
import type { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js'
import type { EgoPose } from '../types'

// ─── Utilities ────────────────────────────────────────────────────────────────

/**
 * Smallest power-of-two ≥ n.
 * Used for buffer over-allocation to amortise reallocation cost on growth.
 */
export function nextPowerOfTwo(n: number): number {
  if (n <= 0) return 1
  let p = 1
  while (p < n) p <<= 1
  return p
}

export interface CoordinateTransformScratch {
  position: THREE.Vector3
  quaternion: THREE.Quaternion
  scale: THREE.Vector3
}

export function createCoordinateTransformScratch(): CoordinateTransformScratch {
  return {
    position: new THREE.Vector3(),
    quaternion: new THREE.Quaternion(),
    scale: new THREE.Vector3(1, 1, 1)
  }
}

export function updateCoordinateTransformInPlace(
  target: THREE.Matrix4,
  coordinate: 'world' | 'ego',
  egoPose: EgoPose | null,
  scratch: CoordinateTransformScratch
): void {
  if (coordinate !== 'ego' || !egoPose) {
    target.identity()
    return
  }

  const { translation, rotation } = egoPose
  scratch.position.set(translation[0], translation[1], translation[2])
  scratch.quaternion.set(rotation[1], rotation[2], rotation[3], rotation[0])
  target.compose(scratch.position, scratch.quaternion, scratch.scale)
}

// ─── Hooks ────────────────────────────────────────────────────────────────────

/**
 * Keeps a LineMaterial's `resolution` uniform in sync with the canvas size.
 * LineMaterial requires this to convert pixel line widths to clip-space offsets.
 */
export function useLineMaterialResolution(mat: LineMaterial | null | undefined) {
  const { size } = useThree()
  useLayoutEffect(() => {
    if (mat) mat.resolution.set(size.width, size.height)
  }, [mat, size.width, size.height])
}
