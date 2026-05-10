import { useMemo, useEffect, useLayoutEffect, useState } from 'react'
import * as THREE from 'three'
import { normalizeDatum } from './_shared'
import type { ImageLayerDatum, LayerBaseProps } from './types'

export interface ImageLayerProps extends LayerBaseProps {
  data: ImageLayerDatum | ImageLayerDatum[]
}

// ImageBitmapLoader decodes images off the main thread via createImageBitmap(),
// avoiding the 70ms+ main-thread PNG decode that TextureLoader triggers.
const _loader = new THREE.ImageBitmapLoader()
// imageOrientation:'flipY' pre-flips in the worker; texture.flipY stays false
// to prevent a second flip during WebGL2 upload (UNPACK_FLIP_Y_WEBGL is no-op for ImageBitmap).
_loader.setOptions({ imageOrientation: 'flipY' })

function disposeMesh(mesh: THREE.Mesh) {
  mesh.geometry.dispose()
  const mat = mesh.material as THREE.MeshBasicMaterial
  mat.map?.dispose()
  mat.dispose()
}

function createMeshFromBitmap(item: ImageLayerDatum, bitmap: ImageBitmap): THREE.Mesh {
  const texture = new THREE.Texture(bitmap)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.flipY = false  // ImageBitmap is already flipped by imageOrientation:'flipY'
  texture.needsUpdate = true

  const geo = new THREE.PlaneGeometry(item.width, item.height)
  const mat = new THREE.MeshBasicMaterial({
    map: texture,
    transparent: true,
    side: THREE.DoubleSide,
    depthWrite: false,
    depthTest: false,
  })

  const mesh = new THREE.Mesh(geo, mat)
  mesh.position.set(item.center[0], item.center[1], item.center[2])
  if (item.rotation) {
    const [w, x, y, z] = item.rotation
    mesh.quaternion.set(x, y, z, w)
  }
  return mesh
}

export function ImageLayer({
  data,
  opacity = 1,
  visible = true,
  renderOrder = 0,
}: ImageLayerProps) {
  const items = useMemo(() => normalizeDatum(data), [data])
  const [meshes, setMeshes] = useState<THREE.Mesh[]>([])

  // Async load: kicks off ImageBitmapLoader requests; decode runs off-thread.
  useEffect(() => {
    if (items.length === 0) {
      setMeshes([])
      return
    }

    let cancelled = false

    Promise.all(
      items.map(
        item =>
          new Promise<THREE.Mesh>((resolve, reject) => {
            _loader.load(
              item.url,
              bitmap => resolve(createMeshFromBitmap(item, bitmap)),
              undefined,
              reject,
            )
          }),
      ),
    ).then(result => {
      if (cancelled) {
        result.forEach(disposeMesh)
      } else {
        setMeshes(result)
      }
    }).catch(() => { /* network errors are silent — mesh stays empty */ })

    return () => { cancelled = true }
  }, [items])

  // Dispose previous meshes whenever the loaded set is replaced.
  useEffect(() => {
    return () => { meshes.forEach(disposeMesh) }
  }, [meshes])

  // Opacity and renderOrder updated in-place — no texture reload.
  useLayoutEffect(() => {
    for (const mesh of meshes) {
      const mat = mesh.material as THREE.MeshBasicMaterial
      mat.opacity     = opacity
      mat.transparent = opacity < 1
      mat.needsUpdate = true
      mesh.renderOrder = renderOrder
    }
  }, [meshes, opacity, renderOrder])

  if (meshes.length === 0) return null

  return (
    <group visible={visible}>
      {meshes.map((mesh, i) => (
        <primitive key={i} object={mesh} />
      ))}
    </group>
  )
}
