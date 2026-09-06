import * as THREE from 'three'
import type { EgoPose } from '../types'

export interface LayerTransformScratch {
  position: THREE.Vector3
  quaternion: THREE.Quaternion
  scale: THREE.Vector3
}

export function createCoordinateTransformScratch(): LayerTransformScratch {
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
  scratch: LayerTransformScratch
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
