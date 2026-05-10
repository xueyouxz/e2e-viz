import { useMemo, useEffect, useRef } from 'react'
import * as THREE from 'three'
import { normalizeDatum, nextPowerOfTwo, _col } from './_shared'
import type { PointLayerDatum, LayerBaseProps } from './types'

// White → orange → red heat colormap for intensity values in [0, 255].
// Stops: 0 → white (#fff), 128 → orange (#ff8c00), 255 → red (#ff1a00)
function intensityToRgb(v: number, out: Float32Array, offset: number): void {
  const t = v / 255
  if (t < 0.5) {
    const s = t * 2
    out[offset]     = 1
    out[offset + 1] = 1 - s * (1 - 0.549)  // 1 → 0.549
    out[offset + 2] = 1 - s                 // 1 → 0
  } else {
    const s = (t - 0.5) * 2
    out[offset]     = 1
    out[offset + 1] = 0.549 * (1 - s)       // 0.549 → 0
    out[offset + 2] = 0.102 * s * 0         // stays 0
  }
}

export interface PointLayerProps extends LayerBaseProps {
  data?: PointLayerDatum | PointLayerDatum[]
  /** Direct typed array [x,y,z,...] — bypasses intermediate object conversion */
  points?: Float32Array
  /** Fallback colour for points that don't specify their own */
  color?: string
  /** Point diameter in world units */
  size?: number
  /** Per-point intensity values in [0, 255]; when provided, overrides per-datum color and color prop */
  intensities?: Float32Array
}

export function PointLayer({
  data,
  points,
  color = '#ffffff',
  size = 0.1,
  opacity = 1,
  visible = true,
  renderOrder = 0,
  intensities,
}: PointLayerProps) {
  const items = useMemo(() => (data != null ? normalizeDatum(data) : []), [data])

  // Persistent geometry — reallocated only when point count exceeds capacity.
  // This avoids GPU buffer upload churn on frequent data updates (e.g. 10 Hz lidar).
  const geoRef      = useRef<THREE.BufferGeometry | null>(null)
  const capacityRef = useRef(0)

  const geometry = useMemo(() => {
    const n = points ? (points.length / 3) | 0 : items.length

    if (n > capacityRef.current) {
      geoRef.current?.dispose()
      const cap = nextPowerOfTwo(n)
      const geo = new THREE.BufferGeometry()
      const posAttr = new THREE.BufferAttribute(new Float32Array(cap * 3), 3)
      const colAttr = new THREE.BufferAttribute(new Float32Array(cap * 3), 3)
      // DYNAMIC_DRAW hints the driver to place these buffers in fast GPU memory.
      posAttr.setUsage(THREE.DynamicDrawUsage)
      colAttr.setUsage(THREE.DynamicDrawUsage)
      geo.setAttribute('position', posAttr)
      geo.setAttribute('color', colAttr)
      geoRef.current = geo
      capacityRef.current = cap
    }

    const geo     = geoRef.current!
    const posAttr = geo.getAttribute('position') as THREE.BufferAttribute
    const colAttr = geo.getAttribute('color') as THREE.BufferAttribute
    const posArr  = posAttr.array as Float32Array
    const colArr  = colAttr.array as Float32Array

    _col.set(color)
    const dr = _col.r, dg = _col.g, db = _col.b

    if (points) {
      // Fast path: single bulk copy for positions (avoids per-point JS overhead)
      posArr.set(points.subarray(0, n * 3), 0)
      if (intensities) {
        for (let i = 0; i < n; i++) intensityToRgb(intensities[i] ?? 0, colArr, i * 3)
      } else {
        for (let i = 0; i < n; i++) {
          colArr[i * 3] = dr; colArr[i * 3 + 1] = dg; colArr[i * 3 + 2] = db
        }
      }
    } else {
      for (let i = 0; i < n; i++) {
        const item = items[i]
        posArr[i * 3]     = item.position[0]
        posArr[i * 3 + 1] = item.position[1]
        posArr[i * 3 + 2] = item.position[2]

        if (intensities) {
          intensityToRgb(intensities[i] ?? 0, colArr, i * 3)
        } else if (item.color) {
          _col.set(item.color)
          colArr[i * 3]     = _col.r
          colArr[i * 3 + 1] = _col.g
          colArr[i * 3 + 2] = _col.b
        } else {
          colArr[i * 3]     = dr
          colArr[i * 3 + 1] = dg
          colArr[i * 3 + 2] = db
        }
      }
    }

    posAttr.needsUpdate = true
    colAttr.needsUpdate = true
    geo.setDrawRange(0, n)

    return geo
  }, [items, points, color, intensities])

  // Dispose the geometry on unmount only — the ref always holds the live geometry.
  useEffect(() => () => geoRef.current?.dispose(), [])

  return (
    <points visible={visible} renderOrder={renderOrder} frustumCulled={false}>
      <primitive object={geometry} attach="geometry" />
      <pointsMaterial
        size={size}
        vertexColors
        sizeAttenuation
        transparent={opacity < 1}
        opacity={opacity}
      />
    </points>
  )
}
