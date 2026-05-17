import { useMemo, useEffect, useRef } from 'react'
import * as THREE from 'three'
import { useSceneStore, useSceneStoreApi } from '../context'
import { useCoordinateTransform } from '../hooks/useCoordinateTransform'
import { _col, nextPowerOfTwo } from './_shared'
import type { PointPayload, LayerRendererProps, StyleConfig } from '../types'

// White → orange → red heat colormap for intensity values in [0, 255].
function intensityToRgb(v: number, out: Float32Array, offset: number): void {
  const t = v / 255
  if (t < 0.5) {
    const s = t * 2
    out[offset] = 1
    out[offset + 1] = 1 - s * (1 - 0.549)
    out[offset + 2] = 1 - s
  } else {
    const s = (t - 0.5) * 2
    out[offset] = 1
    out[offset + 1] = 0.549 * (1 - s)
    out[offset + 2] = 0
  }
}

export function PointRenderer({ streamName, style }: LayerRendererProps) {
  const store = useSceneStoreApi()
  const meta = useSceneStore(s => s.streamsMeta[streamName])
  const payload = useSceneStore(s => s.streamState[streamName]) as PointPayload | undefined
  const visible = useSceneStore(s => s.visibleStreams[streamName] ?? true)
  const frameIndex = useSceneStore(s => (style.styleFn != null ? s.frameIndex : 0))
  const matrix = useCoordinateTransform(meta?.coordinate ?? 'world')

  const effectiveStyle = useMemo<StyleConfig>(() => {
    if (!style.styleFn) return style
    const metrics = store.getState().statistics?.metrics ?? null
    return { ...style, ...style.styleFn({ frameIndex, metrics }) }
  }, [style, frameIndex, store])

  // ── Persistent geometry — reallocated only when point count exceeds capacity ──
  const geoRef = useRef<THREE.BufferGeometry | null>(null)
  const capacityRef = useRef(0)

  const geometry = useMemo(() => {
    const points = payload?.points
    const intensities = payload?.intensity ?? undefined
    const n = points ? (points.length / 3) | 0 : 0

    if (n > capacityRef.current) {
      geoRef.current?.dispose()
      const cap = nextPowerOfTwo(n)
      const geo = new THREE.BufferGeometry()
      const posAttr = new THREE.BufferAttribute(new Float32Array(cap * 3), 3)
      const colAttr = new THREE.BufferAttribute(new Float32Array(cap * 3), 3)
      posAttr.setUsage(THREE.DynamicDrawUsage)
      colAttr.setUsage(THREE.DynamicDrawUsage)
      geo.setAttribute('position', posAttr)
      geo.setAttribute('color', colAttr)
      geoRef.current = geo
      capacityRef.current = cap
    }

    const geo = geoRef.current!
    const posAttr = geo.getAttribute('position') as THREE.BufferAttribute
    const colAttr = geo.getAttribute('color') as THREE.BufferAttribute
    const posArr = posAttr.array as Float32Array
    const colArr = colAttr.array as Float32Array

    _col.set(effectiveStyle.color ?? '#ffffff')
    const dr = _col.r,
      dg = _col.g,
      db = _col.b

    if (points && n > 0) {
      posArr.set(points.subarray(0, n * 3), 0)
      if (intensities) {
        for (let i = 0; i < n; i++) intensityToRgb(intensities[i] ?? 0, colArr, i * 3)
      } else {
        for (let i = 0; i < n; i++) {
          colArr[i * 3] = dr
          colArr[i * 3 + 1] = dg
          colArr[i * 3 + 2] = db
        }
      }
    }

    posAttr.needsUpdate = true
    colAttr.needsUpdate = true
    geo.setDrawRange(0, n)
    return geo
  }, [payload, effectiveStyle.color])

  useEffect(() => () => geoRef.current?.dispose(), [])

  if (!visible || !payload) return null

  return (
    <group matrix={matrix} matrixAutoUpdate={false}>
      <points visible={visible} renderOrder={effectiveStyle.renderOrder ?? 0} frustumCulled={false}>
        <primitive object={geometry} attach='geometry' />
        <pointsMaterial
          size={0.1}
          vertexColors
          sizeAttenuation
          transparent={(effectiveStyle.opacity ?? 1) < 1}
          opacity={effectiveStyle.opacity ?? 1}
        />
      </points>
    </group>
  )
}
