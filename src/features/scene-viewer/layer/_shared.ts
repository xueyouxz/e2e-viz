import { useLayoutEffect } from 'react'
import * as THREE from 'three'
import { useThree } from '@react-three/fiber'
import type { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js'

// ─── Module-level temporaries ─────────────────────────────────────────────────
// Safe to share across layers: all usages are synchronous and non-reentrant.

export const _col  = new THREE.Color()
export const _v3   = new THREE.Vector3()
export const _mat4 = new THREE.Matrix4()
export const _pos  = new THREE.Vector3()
export const _quat = new THREE.Quaternion()
export const _scl  = new THREE.Vector3()

// ─── Utilities ────────────────────────────────────────────────────────────────

/** Normalise a single datum or array to always be an array. */
export function normalizeDatum<T>(data: T | T[]): T[] {
  return Array.isArray(data) ? data : [data]
}

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
