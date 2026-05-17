import { useMemo, useEffect, useLayoutEffect, useState } from 'react'
import * as THREE from 'three'
import { useSceneStore, useSceneStoreApi } from '../context'
import { useCoordinateTransform } from '../hooks/useCoordinateTransform'
import type { ImagePayload, LayerRendererProps, StyleConfig } from '../types'

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

function createMeshFromPayload(payload: ImagePayload, bitmap: ImageBitmap): THREE.Mesh | null {
  if (!payload.bounds) return null
  const { min_x, min_y, max_x, max_y } = payload.bounds
  const width = max_x - min_x
  const height = max_y - min_y
  const cx = (min_x + max_x) / 2
  const cy = (min_y + max_y) / 2

  const texture = new THREE.Texture(bitmap)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.flipY = false
  texture.needsUpdate = true

  const geo = new THREE.PlaneGeometry(width, height)
  const mat = new THREE.MeshBasicMaterial({
    map: texture,
    transparent: true,
    side: THREE.DoubleSide,
    depthWrite: false,
    depthTest: false
  })

  const mesh = new THREE.Mesh(geo, mat)
  mesh.position.set(cx, cy, 0)
  return mesh
}

export function ImageRenderer({ streamName, style }: LayerRendererProps) {
  const store = useSceneStoreApi()
  const meta = useSceneStore(s => s.streamsMeta[streamName])
  const payload = useSceneStore(s => s.streamState[streamName]) as ImagePayload | undefined
  const visible = useSceneStore(s => s.visibleStreams[streamName] ?? true)
  const frameIndex = useSceneStore(s => (style.styleFn != null ? s.frameIndex : 0))
  const matrix = useCoordinateTransform(meta?.coordinate ?? 'world')

  const effectiveStyle = useMemo<StyleConfig>(() => {
    if (!style.styleFn) return style
    const metrics = store.getState().statistics?.metrics ?? null
    return { ...style, ...style.styleFn({ frameIndex, metrics }) }
  }, [style, frameIndex, store])

  const [mesh, setMesh] = useState<THREE.Mesh | null>(null)

  // Async load: kicks off ImageBitmapLoader; decode runs off-thread.
  useEffect(() => {
    if (!payload?.url || !payload.bounds) {
      setMesh(null)
      return
    }

    let cancelled = false
    const url = payload.url

    new Promise<THREE.Mesh | null>((resolve, reject) => {
      _loader.load(
        url,
        bitmap => resolve(createMeshFromPayload(payload, bitmap)),
        undefined,
        reject
      )
    })
      .then(result => {
        if (cancelled) {
          if (result) disposeMesh(result)
        } else {
          setMesh(result)
        }
      })
      .catch(() => {
        /* network errors are silent — mesh stays empty */
      })

    return () => {
      cancelled = true
    }
  }, [payload])

  // Dispose previous mesh whenever the loaded mesh is replaced.
  useEffect(() => {
    return () => {
      if (mesh) disposeMesh(mesh)
    }
  }, [mesh])

  // Opacity and renderOrder updated in-place — no texture reload.
  useLayoutEffect(() => {
    if (!mesh) return
    const mat = mesh.material as THREE.MeshBasicMaterial
    mat.opacity = effectiveStyle.opacity ?? 1
    mat.transparent = (effectiveStyle.opacity ?? 1) < 1
    mat.needsUpdate = true
    mesh.renderOrder = effectiveStyle.renderOrder ?? 0
  }, [mesh, effectiveStyle.opacity, effectiveStyle.renderOrder])

  if (!visible || !mesh) return null

  return (
    <group matrix={matrix} matrixAutoUpdate={false}>
      <primitive object={mesh} />
    </group>
  )
}
