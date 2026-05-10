import { useMemo, useRef } from 'react'
import * as THREE from 'three'
import { useFrame } from '@react-three/fiber'
import { useGLTF } from '@react-three/drei'
import { useSceneStoreApi } from '../context'

function wxyzToXyzw(q: [number, number, number, number]): [number, number, number, number] {
  return [q[1], q[2], q[3], q[0]]
}

const EGO_MODEL_URL = '/ego.glb'
const EGO_RENDER_ORDER = 90
const EGO_MODEL_FORWARD_OFFSET_M = 0.9

const MODEL_TO_EGO_QUAT = new THREE.Quaternion().setFromEuler(
  new THREE.Euler(-Math.PI / 2, 0, Math.PI, 'XYZ'),
)

const _pos = new THREE.Vector3()
const _quat = new THREE.Quaternion()
const _offset = new THREE.Vector3()

function prepareEgoScene(root: THREE.Object3D): THREE.Object3D {
  root.traverse((child) => {
    child.frustumCulled = false
    child.renderOrder = EGO_RENDER_ORDER

    if (child instanceof THREE.Mesh) {
      child.material = Array.isArray(child.material)
        ? child.material.map((m: THREE.Material) => m.clone())
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
    }
  })
  return root
}

export function EgoVehicle() {
  const store = useSceneStoreApi()
  const groupRef = useRef<THREE.Group>(null)
  const { scene } = useGLTF(EGO_MODEL_URL)
  const egoScene = useMemo(() => prepareEgoScene(scene.clone()), [scene])

  useFrame(() => {
    const egoPose = store.getState().egoPose
    if (!egoPose || !groupRef.current) return

    const { translation, rotation } = egoPose
    _pos.set(translation[0], translation[1], translation[2])

    const [qx, qy, qz, qw] = wxyzToXyzw(rotation)
    _quat.set(qx, qy, qz, qw)

    _offset.set(EGO_MODEL_FORWARD_OFFSET_M, 0, 0).applyQuaternion(_quat)
    groupRef.current.position.copy(_pos).add(_offset)
    groupRef.current.quaternion.copy(_quat).multiply(MODEL_TO_EGO_QUAT)
  })

  return (
    <group ref={groupRef} frustumCulled={false} renderOrder={EGO_RENDER_ORDER}>
      <primitive object={egoScene} />
    </group>
  )
}

useGLTF.preload(EGO_MODEL_URL)
