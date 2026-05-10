import { useMemo } from 'react'
import * as THREE from 'three'
import { useSceneStore } from '../context'
import type { EgoPose } from '../types'

const IDENTITY = new THREE.Matrix4()

function buildEgoMatrix(pose: EgoPose): THREE.Matrix4 {
  const [w, x, y, z] = pose.rotation
  const quat = new THREE.Quaternion(x, y, z, w)
  const pos = new THREE.Vector3(...pose.translation)
  return new THREE.Matrix4().compose(pos, quat, new THREE.Vector3(1, 1, 1))
}

export function useCoordinateTransform(coordinate: 'world' | 'ego'): THREE.Matrix4 {
  const egoPose = useSceneStore((s) => s.egoPose)

  return useMemo(() => {
    if (coordinate === 'world' || !egoPose) return IDENTITY
    return buildEgoMatrix(egoPose)
  }, [coordinate, egoPose])
}
