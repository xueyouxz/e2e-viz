import { useMemo, useEffect, useLayoutEffect } from 'react'
import * as THREE from 'three'
import { useSceneStore, useSceneStoreApi } from '../context'
import { useCoordinateTransform } from '../hooks/useCoordinateTransform'
import { _col } from './_shared'
import type { PolylinePayload, LayerRendererProps, StyleConfig } from '../types'

// ─── Capacity ─────────────────────────────────────────────────────────────────
// MAX_RIBBON_VERTS: 2 verts per path-point (left / right ribbon edge).
// Sized for the densest expected stream: ~64 objects × ~20 waypoints × 2 = 2560.
// Indices: each pair of adjacent ribbon verts = 1 quad = 6 indices.
const MAX_RIBBON_VERTS = 8192
const MAX_RIBBON_INDICES = MAX_RIBBON_VERTS * 3 // upper bound: quads per vert pair

/**
 * Writes ribbon geometry for all polylines in `payload` directly into
 * pre-allocated typed arrays. Returns the actual vertex and index counts written.
 *
 * Tangents are pre-computed per segment (one sqrt each) and averaged at interior
 * vertices, halving the sqrt count vs a per-vertex approach.
 */
function buildRibbonsInPlace(
  payload: PolylinePayload,
  posArr: Float32Array,
  colArr: Float32Array,
  idxArr: Uint32Array,
  color: string,
  lineWidth: number
): { vertCount: number; idxCount: number } {
  const { vertices, offsets, count } = payload
  const hw = lineWidth * 0.5

  _col.set(color)
  const cr = _col.r,
    cg = _col.g,
    cb = _col.b

  let vIdx = 0 // next vertex slot
  let iIdx = 0 // next index slot

  for (let p = 0; p < count; p++) {
    const start = offsets[p]
    const end = offsets[p + 1]
    const n = end - start
    if (n < 2) continue

    // Guard: skip if this path alone would overflow the pre-allocated buffers.
    if (vIdx + n * 2 > MAX_RIBBON_VERTS || iIdx + (n - 1) * 6 > MAX_RIBBON_INDICES) break

    // Pre-compute per-segment unit tangents: O(n-1) sqrts.
    const stx = new Float32Array(n - 1)
    const sty = new Float32Array(n - 1)
    for (let s = 0; s < n - 1; s++) {
      const ai = (start + s) * 3,
        bi = (start + s + 1) * 3
      const dx = vertices[bi] - vertices[ai]
      const dy = vertices[bi + 1] - vertices[ai + 1]
      const len = Math.sqrt(dx * dx + dy * dy)
      stx[s] = len > 1e-6 ? dx / len : 0
      sty[s] = len > 1e-6 ? dy / len : 0
    }

    const baseVert = vIdx

    for (let i = 0; i < n; i++) {
      const vi = (start + i) * 3
      const px = vertices[vi],
        py = vertices[vi + 1],
        pz = vertices[vi + 2]

      let nx: number, ny: number
      if (i === 0) {
        nx = -sty[0]
        ny = stx[0]
      } else if (i === n - 1) {
        nx = -sty[n - 2]
        ny = stx[n - 2]
      } else {
        const ax = stx[i - 1] + stx[i],
          ay = sty[i - 1] + sty[i]
        const al = Math.sqrt(ax * ax + ay * ay)
        nx = al > 1e-6 ? -ay / al : -sty[i]
        ny = al > 1e-6 ? ax / al : stx[i]
      }

      const li = vIdx,
        ri = vIdx + 1

      posArr[li * 3] = px + nx * hw
      posArr[li * 3 + 1] = py + ny * hw
      posArr[li * 3 + 2] = pz
      posArr[ri * 3] = px - nx * hw
      posArr[ri * 3 + 1] = py - ny * hw
      posArr[ri * 3 + 2] = pz

      colArr[li * 3] = cr
      colArr[li * 3 + 1] = cg
      colArr[li * 3 + 2] = cb
      colArr[ri * 3] = cr
      colArr[ri * 3 + 1] = cg
      colArr[ri * 3 + 2] = cb

      vIdx += 2
    }

    for (let i = 0; i < n - 1; i++) {
      const li = baseVert + i * 2,
        ri = li + 1
      idxArr[iIdx++] = li
      idxArr[iIdx++] = ri
      idxArr[iIdx++] = li + 2
      idxArr[iIdx++] = ri
      idxArr[iIdx++] = ri + 2
      idxArr[iIdx++] = li + 2
    }
  }

  return { vertCount: vIdx, idxCount: iIdx }
}

export function PathRenderer({ streamName, style }: LayerRendererProps) {
  const store = useSceneStoreApi()
  const meta = useSceneStore(s => s.streamsMeta[streamName])
  const payload = useSceneStore(s => s.streamState[streamName]) as PolylinePayload | undefined
  const visible = useSceneStore(s => s.visibleStreams[streamName] ?? true)
  const frameIndex = useSceneStore(s => (style.styleFn != null ? s.frameIndex : 0))
  const matrix = useCoordinateTransform(meta?.coordinate ?? 'world')

  const effectiveStyle = useMemo<StyleConfig>(() => {
    if (!style.styleFn) return style
    const metrics = store.getState().statistics?.metrics ?? null
    return { ...style, ...style.styleFn({ frameIndex, metrics }) }
  }, [style, frameIndex, store])

  // ── Persistent geometry objects — allocated once on mount ────────────────────
  const { mesh, posAttr, colAttr, idxAttr } = useMemo(() => {
    const posArr = new Float32Array(MAX_RIBBON_VERTS * 3)
    const colArr = new Float32Array(MAX_RIBBON_VERTS * 3)
    const idxArr = new Uint32Array(MAX_RIBBON_INDICES)

    const posAttr = new THREE.BufferAttribute(posArr, 3)
    const colAttr = new THREE.BufferAttribute(colArr, 3)
    const idxAttr = new THREE.BufferAttribute(idxArr, 1)
    posAttr.setUsage(THREE.DynamicDrawUsage)
    colAttr.setUsage(THREE.DynamicDrawUsage)
    idxAttr.setUsage(THREE.DynamicDrawUsage)

    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', posAttr)
    geo.setAttribute('color', colAttr)
    geo.setIndex(idxAttr)
    geo.setDrawRange(0, 0)

    const mat = new THREE.MeshBasicMaterial({
      vertexColors: true,
      transparent: true,
      side: THREE.DoubleSide,
      depthWrite: false,
      depthTest: false
    })

    return { mesh: new THREE.Mesh(geo, mat), posAttr, colAttr, idxAttr }
  }, [])

  // Opacity and renderOrder — no geometry rebuild needed.
  useLayoutEffect(() => {
    const mat = mesh.material as THREE.MeshBasicMaterial
    mat.opacity = effectiveStyle.opacity ?? 1
    mat.transparent = (effectiveStyle.opacity ?? 1) < 1
    mat.needsUpdate = true
    mesh.renderOrder = effectiveStyle.renderOrder ?? 0
  }, [mesh, effectiveStyle.opacity, effectiveStyle.renderOrder])

  // Update ribbon geometry in-place on payload or style change.
  useMemo(() => {
    const geo = mesh.geometry
    if (!payload || payload.type !== 'polyline') {
      geo.setDrawRange(0, 0)
      return
    }

    const { idxCount } = buildRibbonsInPlace(
      payload,
      posAttr.array as Float32Array,
      colAttr.array as Float32Array,
      idxAttr.array as Uint32Array,
      effectiveStyle.color ?? '#facc15',
      effectiveStyle.lineWidth ?? 0.5
    )

    posAttr.needsUpdate = true
    colAttr.needsUpdate = true
    idxAttr.needsUpdate = true
    geo.setDrawRange(0, idxCount)
    if (idxCount > 0) geo.computeBoundingSphere()
  }, [payload, effectiveStyle.color, effectiveStyle.lineWidth, mesh, posAttr, colAttr, idxAttr])

  useEffect(() => {
    return () => {
      mesh.geometry.dispose()
      ;(mesh.material as THREE.Material).dispose()
    }
  }, [mesh])

  if (!visible || !payload) return null

  return (
    <group matrix={matrix} matrixAutoUpdate={false}>
      <primitive object={mesh} visible={visible} />
    </group>
  )
}
