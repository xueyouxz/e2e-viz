import { useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { useFrame } from '@react-three/fiber'
import { useSceneStoreApi } from '../context'
import {
  createCoordinateTransformScratch,
  updateCoordinateTransformInPlace
} from './layerTransform'
import type { EgoPose, ImagePayload, StreamLayerProps } from '../types'

function disposeMesh(mesh: THREE.Mesh): void {
  mesh.geometry.dispose()
  const material = mesh.material as THREE.MeshBasicMaterial
  const image = material.map?.image as { close?: () => void } | undefined
  image?.close?.()
  material.map?.dispose()
  material.dispose()
}

function createMesh(payload: ImagePayload, bitmap: ImageBitmap): THREE.Mesh | null {
  if (!payload.bounds) {
    bitmap.close()
    return null
  }

  const { min_x, min_y, max_x, max_y } = payload.bounds
  const texture = new THREE.Texture(bitmap)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.flipY = false
  texture.needsUpdate = true
  const geometry = new THREE.PlaneGeometry(max_x - min_x, max_y - min_y)
  const material = new THREE.MeshBasicMaterial({
    map: texture,
    transparent: true,
    side: THREE.DoubleSide,
    depthWrite: false,
    depthTest: false
  })
  const mesh = new THREE.Mesh(geometry, material)
  mesh.position.set((min_x + max_x) / 2, (min_y + max_y) / 2, 0)
  return mesh
}

export function ImageLayer({ streamName, style }: StreamLayerProps) {
  const store = useSceneStoreApi()
  const groupRef = useRef<THREE.Group>(null)
  const styleRef = useRef(style)
  useLayoutEffect(() => {
    styleRef.current = style
  }, [style])

  const resources = useMemo(() => {
    const loader = new THREE.ImageBitmapLoader()
    loader.setOptions({ imageOrientation: 'flipY' })
    return {
      container: new THREE.Group(),
      loader,
      mesh: null as THREE.Mesh | null,
      requestToken: 0,
      mounted: true,
      opacity: 1,
      renderOrder: 0,
      transformScratch: createCoordinateTransformScratch()
    }
  }, [])

  const previous = useRef<{
    payload?: ImagePayload
    visible: boolean
    coordinate: 'world' | 'ego'
    egoPose: EgoPose | null
    opacity: number
    renderOrder: number
  }>({
    visible: true,
    coordinate: 'world',
    egoPose: null,
    opacity: Number.NaN,
    renderOrder: Number.NaN
  })

  useFrame(() => {
    const group = groupRef.current
    if (!group) return

    const state = store.getState()
    const payload = state.streamState[streamName] as ImagePayload | undefined
    const visible = state.visibleStreams[streamName] ?? true
    const coordinate = state.streamsMeta[streamName]?.coordinate ?? 'world'
    const currentStyle = styleRef.current
    const override = currentStyle.styleFn?.({
      frameIndex: state.displayedFrameIndex,
      metrics: state.statistics?.metrics ?? null
    })
    const opacity = override?.opacity ?? currentStyle.opacity ?? 1
    const renderOrder = override?.renderOrder ?? currentStyle.renderOrder ?? 0
    const prev = previous.current

    if (coordinate !== prev.coordinate || state.egoPose !== prev.egoPose) {
      updateCoordinateTransformInPlace(
        group.matrix,
        coordinate,
        state.egoPose,
        resources.transformScratch
      )
      group.matrixWorldNeedsUpdate = true
      prev.coordinate = coordinate
      prev.egoPose = state.egoPose
    }
    if (visible !== prev.visible) {
      resources.container.visible = visible
      prev.visible = visible
    }
    if (opacity !== prev.opacity || renderOrder !== prev.renderOrder) {
      resources.opacity = opacity
      resources.renderOrder = renderOrder
      if (resources.mesh) {
        const material = resources.mesh.material as THREE.MeshBasicMaterial
        material.opacity = opacity
        material.transparent = opacity < 1
        material.needsUpdate = true
        resources.mesh.renderOrder = renderOrder
      }
      prev.opacity = opacity
      prev.renderOrder = renderOrder
    }

    if (payload === prev.payload) return
    prev.payload = payload
    const requestToken = ++resources.requestToken

    if (!payload?.url || !payload.bounds) {
      if (resources.mesh) {
        resources.container.remove(resources.mesh)
        disposeMesh(resources.mesh)
        resources.mesh = null
      }
      return
    }

    resources.loader.load(
      payload.url,
      bitmap => {
        if (!resources.mounted || requestToken !== resources.requestToken) {
          bitmap.close()
          return
        }

        const mesh = createMesh(payload, bitmap)
        if (!mesh) return
        const material = mesh.material as THREE.MeshBasicMaterial
        material.opacity = resources.opacity
        material.transparent = resources.opacity < 1
        mesh.renderOrder = resources.renderOrder

        if (resources.mesh) {
          resources.container.remove(resources.mesh)
          disposeMesh(resources.mesh)
        }
        resources.mesh = mesh
        resources.container.add(mesh)
      },
      undefined,
      () => {
        // Keep the last valid image when the replacement cannot be decoded.
      }
    )
  })

  useEffect(() => {
    resources.mounted = true
    return () => {
      resources.mounted = false
      resources.requestToken++
      if (resources.mesh) {
        resources.container.remove(resources.mesh)
        disposeMesh(resources.mesh)
        resources.mesh = null
      }
    }
  }, [resources])

  return (
    <group ref={groupRef} matrixAutoUpdate={false}>
      <primitive object={resources.container} />
    </group>
  )
}
