import { useMemo, useEffect, useLayoutEffect } from 'react'
import * as THREE from 'three'
import { normalizeDatum, _col } from './_shared'
import type { PathLayerDatum, LayerBaseProps } from './types'

const DEFAULT_WIDTH = 0.5  // world units (metres)

export interface PathLayerProps extends LayerBaseProps {
  data: PathLayerDatum | PathLayerDatum[]
  /** Fallback colour for paths without their own colour */
  color?: string
  /** Fallback ribbon width in world units for paths without their own width */
  lineWidth?: number
}

/**
 * Merges all path ribbons into a single BufferGeometry with vertex colours,
 * reducing draw calls from N to 1.
 *
 * Tangents are pre-computed per segment (one sqrt each) and then averaged at
 * interior vertices, halving the sqrt count vs the per-vertex approach.
 */
function buildAllRibbons(
  items: PathLayerDatum[],
  fallbackColor: string,
  fallbackWidth: number,
): THREE.Mesh | null {
  const valid = items.filter(item => item.positions.length >= 2)
  if (valid.length === 0) return null

  // Pre-calculate exact buffer sizes — avoids dynamic array growth.
  let totalVerts   = 0
  let totalIndices = 0
  for (const item of valid) {
    const n = item.positions.length
    totalVerts   += n * 2
    totalIndices += (n - 1) * 6
  }

  const positions = new Float32Array(totalVerts * 3)
  const colors    = new Float32Array(totalVerts * 3)
  const indices   = new Uint32Array(totalIndices)

  let vIdx = 0  // vertex index
  let iIdx = 0  // index array cursor

  for (const item of valid) {
    const pts = item.positions
    const n   = pts.length
    const hw  = (item.width ?? fallbackWidth) * 0.5

    _col.set(item.color ?? fallbackColor)
    const { r, g, b } = _col

    // Pre-compute per-segment unit tangents: O(n-1) sqrts instead of O(2n).
    const stx = new Float32Array(n - 1)
    const sty = new Float32Array(n - 1)
    for (let s = 0; s < n - 1; s++) {
      const dx  = pts[s + 1][0] - pts[s][0]
      const dy  = pts[s + 1][1] - pts[s][1]
      const len = Math.sqrt(dx * dx + dy * dy)
      stx[s] = len > 1e-6 ? dx / len : 0
      sty[s] = len > 1e-6 ? dy / len : 0
    }

    const baseVert = vIdx

    for (let i = 0; i < n; i++) {
      const p = pts[i]
      let nx: number, ny: number  // unit normal (perpendicular to tangent)

      if (i === 0) {
        nx = -sty[0]; ny = stx[0]
      } else if (i === n - 1) {
        nx = -sty[n - 2]; ny = stx[n - 2]
      } else {
        // Average adjacent segment tangents → bevel join without miter spikes.
        const ax = stx[i - 1] + stx[i]
        const ay = sty[i - 1] + sty[i]
        const al = Math.sqrt(ax * ax + ay * ay)
        nx = al > 1e-6 ? -ay / al : -sty[i]
        ny = al > 1e-6 ?  ax / al :  stx[i]
      }

      const li = vIdx,     ri = vIdx + 1

      positions[li * 3]     = p[0] + nx * hw
      positions[li * 3 + 1] = p[1] + ny * hw
      positions[li * 3 + 2] = p[2]
      positions[ri * 3]     = p[0] - nx * hw
      positions[ri * 3 + 1] = p[1] - ny * hw
      positions[ri * 3 + 2] = p[2]

      colors[li * 3] = r;  colors[li * 3 + 1] = g;  colors[li * 3 + 2] = b
      colors[ri * 3] = r;  colors[ri * 3 + 1] = g;  colors[ri * 3 + 2] = b

      vIdx += 2
    }

    for (let i = 0; i < n - 1; i++) {
      const li = baseVert + i * 2
      const ri = baseVert + i * 2 + 1
      indices[iIdx++] = li;      indices[iIdx++] = ri;      indices[iIdx++] = li + 2
      indices[iIdx++] = ri;      indices[iIdx++] = ri + 2;  indices[iIdx++] = li + 2
    }
  }

  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geo.setAttribute('color',    new THREE.BufferAttribute(colors, 3))
  geo.setIndex(new THREE.BufferAttribute(indices, 1))
  geo.computeBoundingSphere()

  const mat = new THREE.MeshBasicMaterial({
    vertexColors: true,
    transparent: true,
    side: THREE.DoubleSide,
    depthWrite: false,
    depthTest: false,
  })

  return new THREE.Mesh(geo, mat)
}

export function PathLayer({
  data,
  color = '#facc15',
  lineWidth = DEFAULT_WIDTH,
  opacity = 1,
  visible = true,
  renderOrder = 0,
}: PathLayerProps) {
  const items = useMemo(() => normalizeDatum(data), [data])

  // Geometry rebuilt only when shape data changes — opacity/renderOrder handled separately.
  const mesh = useMemo(
    () => buildAllRibbons(items, color, lineWidth),
    [items, color, lineWidth],
  )

  // Opacity and renderOrder are material/object properties — no rebuild needed.
  useLayoutEffect(() => {
    if (!mesh) return
    const mat = mesh.material as THREE.MeshBasicMaterial
    mat.opacity    = opacity
    mat.transparent = opacity < 1
    mat.needsUpdate = true
    mesh.renderOrder = renderOrder
  }, [mesh, opacity, renderOrder])

  useEffect(() => {
    return () => {
      mesh?.geometry.dispose()
      ;(mesh?.material as THREE.Material | undefined)?.dispose()
    }
  }, [mesh])

  if (!mesh) return null

  return (
    <group visible={visible}>
      <primitive object={mesh} />
    </group>
  )
}
