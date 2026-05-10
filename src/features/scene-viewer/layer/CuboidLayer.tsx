import { useMemo, useEffect, useLayoutEffect } from 'react'
import * as THREE from 'three'
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js'
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js'
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js'
import { normalizeDatum, useLineMaterialResolution, _col, _v3, _mat4, _pos, _quat, _scl } from './_shared'
import type { CuboidLayerDatum, LayerBaseProps } from './types'

const EDGE_LINE_WIDTH = 1.5  // px

// ─── Shared unit-box geometry ─────────────────────────────────────────────────
// Single allocation for the lifetime of the application.
// IMPORTANT: never call dispose() on this reference.
const UNIT_BOX_GEO = new THREE.BoxGeometry(1, 1, 1)

// ─── Unit-cube edge table ─────────────────────────────────────────────────────

const UNIT_EDGE_CORNERS = [
  [-0.5, -0.5, -0.5], [+0.5, -0.5, -0.5], [+0.5, +0.5, -0.5], [-0.5, +0.5, -0.5],
  [-0.5, -0.5, +0.5], [+0.5, -0.5, +0.5], [+0.5, +0.5, +0.5], [-0.5, +0.5, +0.5],
] as const

const UNIT_EDGE_PAIRS = [
  [0, 1], [1, 2], [2, 3], [3, 0],  // bottom face
  [4, 5], [5, 6], [6, 7], [7, 4],  // top face
  [0, 4], [1, 5], [2, 6], [3, 7],  // verticals
] as const

const VERTS_PER_BOX = UNIT_EDGE_PAIRS.length * 2  // 24

const UNIT_EDGE_POSITIONS: Float32Array = (() => {
  const buf = new Float32Array(VERTS_PER_BOX * 3)
  let w = 0
  for (const [a, b] of UNIT_EDGE_PAIRS) {
    buf[w++] = UNIT_EDGE_CORNERS[a][0]; buf[w++] = UNIT_EDGE_CORNERS[a][1]; buf[w++] = UNIT_EDGE_CORNERS[a][2]
    buf[w++] = UNIT_EDGE_CORNERS[b][0]; buf[w++] = UNIT_EDGE_CORNERS[b][1]; buf[w++] = UNIT_EDGE_CORNERS[b][2]
  }
  return buf
})()

// ─── Build helpers ────────────────────────────────────────────────────────────

export interface CuboidLayerProps extends LayerBaseProps {
  data: CuboidLayerDatum | CuboidLayerDatum[]
  /** Fallback fill colour */
  color?: string
}

interface CuboidObjects {
  fillMesh: THREE.InstancedMesh
  edgeLines: LineSegments2
  edgeMat: LineMaterial
}

function buildCuboidObjects(
  items: CuboidLayerDatum[],
  fallbackColor: string,
): CuboidObjects {
  const count = items.length

  const fillMat = new THREE.MeshBasicMaterial({
    transparent: true,
    depthTest: true,
    depthWrite: false,
  })
  // UNIT_BOX_GEO is shared — InstancedMesh holds a reference, not ownership.
  const fillMesh = new THREE.InstancedMesh(UNIT_BOX_GEO, fillMat, Math.max(count, 1))
  fillMesh.count = count

  const edgePosBuf = new Float32Array(count * VERTS_PER_BOX * 3)
  const edgeColBuf = new Float32Array(count * VERTS_PER_BOX * 3)

  for (let i = 0; i < count; i++) {
    const item = items[i]

    _pos.set(item.center[0], item.center[1], item.center[2])
    if (item.rotation) {
      const [w, x, y, z] = item.rotation
      _quat.set(x, y, z, w)
    } else {
      _quat.identity()
    }
    // nuScenes wlh: x←length, y←width, z←height
    _scl.set(item.size[1], item.size[0], item.size[2])
    _mat4.compose(_pos, _quat, _scl)

    fillMesh.setMatrixAt(i, _mat4)
    _col.set(item.color ?? fallbackColor)
    fillMesh.setColorAt(i, _col)

    const base = i * VERTS_PER_BOX
    for (let v = 0; v < VERTS_PER_BOX; v++) {
      _v3.set(
        UNIT_EDGE_POSITIONS[v * 3],
        UNIT_EDGE_POSITIONS[v * 3 + 1],
        UNIT_EDGE_POSITIONS[v * 3 + 2],
      )
      _v3.applyMatrix4(_mat4)
      const off = (base + v) * 3
      edgePosBuf[off]     = _v3.x
      edgePosBuf[off + 1] = _v3.y
      edgePosBuf[off + 2] = _v3.z
      edgeColBuf[off]     = _col.r
      edgeColBuf[off + 1] = _col.g
      edgeColBuf[off + 2] = _col.b
    }
  }

  if (count > 0) {
    fillMesh.instanceMatrix.needsUpdate = true
    if (fillMesh.instanceColor) fillMesh.instanceColor.needsUpdate = true
  }

  const edgeSegsGeo = new LineSegmentsGeometry()
  if (count > 0) {
    edgeSegsGeo.setPositions(edgePosBuf)
    edgeSegsGeo.setColors(edgeColBuf)
  }

  const edgeMat = new LineMaterial({
    linewidth: EDGE_LINE_WIDTH,
    vertexColors: true,
    resolution: new THREE.Vector2(1, 1),
    transparent: true,
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
  })

  const edgeLines = new LineSegments2(edgeSegsGeo, edgeMat)

  return { fillMesh, edgeLines, edgeMat }
}

// ─── Component ────────────────────────────────────────────────────────────────

export function CuboidLayer({
  data,
  color = '#4b8cf8',
  opacity = 0.35,
  visible = true,
  renderOrder = 0,
}: CuboidLayerProps) {
  const items = useMemo(() => normalizeDatum(data), [data])

  const { fillMesh, edgeLines, edgeMat } = useMemo(
    () => buildCuboidObjects(items, color),
    [items, color],
  )

  // Opacity and renderOrder are independent of geometry — update in-place.
  useLayoutEffect(() => {
    const mat = fillMesh.material as THREE.MeshBasicMaterial
    mat.opacity = opacity
    mat.transparent = opacity < 1
    fillMesh.renderOrder = renderOrder
    edgeLines.renderOrder = renderOrder + 10
  }, [fillMesh, edgeLines, opacity, renderOrder])

  useLineMaterialResolution(edgeMat)

  useEffect(() => {
    return () => {
      // Do NOT dispose UNIT_BOX_GEO — it is the shared module-level singleton.
      ;(fillMesh.material as THREE.Material).dispose()
      edgeLines.geometry.dispose()
      edgeMat.dispose()
    }
  }, [fillMesh, edgeLines, edgeMat])

  if (items.length === 0) return null

  return (
    <group visible={visible}>
      <primitive object={fillMesh} />
      <primitive object={edgeLines} />
    </group>
  )
}
