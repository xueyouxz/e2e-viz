import { useRef, useMemo, useEffect, useLayoutEffect, useCallback } from 'react'
import * as THREE from 'three'
import { useFrame, type ThreeEvent } from '@react-three/fiber'
import { useSceneStoreApi } from '../context'
import type { CuboidPayload, LayerRendererProps } from '../types'

// ─── Capacity ─────────────────────────────────────────────────────────────────

const MAX_CUBOIDS = 256
const VERTS_PER_BOX = 24  // 12 edges × 2 endpoints

// ─── Shared unit-box geometry (singleton, never disposed) ─────────────────────

const UNIT_BOX_GEO = new THREE.BoxGeometry(1, 1, 1)

// ─── Unit-cube edge table ─────────────────────────────────────────────────────

const UNIT_EDGE_CORNERS = [
  [-0.5, -0.5, -0.5], [+0.5, -0.5, -0.5], [+0.5, +0.5, -0.5], [-0.5, +0.5, -0.5],
  [-0.5, -0.5, +0.5], [+0.5, -0.5, +0.5], [+0.5, +0.5, +0.5], [-0.5, +0.5, +0.5],
] as const

const UNIT_EDGE_PAIRS = [
  [0, 1], [1, 2], [2, 3], [3, 0],
  [4, 5], [5, 6], [6, 7], [7, 4],
  [0, 4], [1, 5], [2, 6], [3, 7],
] as const

const UNIT_EDGE_POSITIONS: Float32Array = (() => {
  const buf = new Float32Array(VERTS_PER_BOX * 3)
  let w = 0
  for (const [a, b] of UNIT_EDGE_PAIRS) {
    buf[w++] = UNIT_EDGE_CORNERS[a][0]; buf[w++] = UNIT_EDGE_CORNERS[a][1]; buf[w++] = UNIT_EDGE_CORNERS[a][2]
    buf[w++] = UNIT_EDGE_CORNERS[b][0]; buf[w++] = UNIT_EDGE_CORNERS[b][1]; buf[w++] = UNIT_EDGE_CORNERS[b][2]
  }
  return buf
})()

// ─── Module-level temporaries (safe: all usages are synchronous/non-reentrant) ─

const _pos   = new THREE.Vector3()
const _quat  = new THREE.Quaternion()
const _scl   = new THREE.Vector3()
const _mat4  = new THREE.Matrix4()
const _col   = new THREE.Color()
const _v3    = new THREE.Vector3()
// Ego-coordinate transform
const _egoPos   = new THREE.Vector3()
const _egoQuat  = new THREE.Quaternion()
const _egoScale = new THREE.Vector3(1, 1, 1)
const _egoMat   = new THREE.Matrix4()

// ─── Component ────────────────────────────────────────────────────────────────

export function CuboidRenderer({ streamName, style }: LayerRendererProps) {
  const store     = useSceneStoreApi()
  const groupRef  = useRef<THREE.Group>(null)
  const styleRef  = useRef(style)
  const nameRef   = useRef(streamName)
  useLayoutEffect(() => { styleRef.current = style }, [style])

  // ── Persistent Three.js objects created once per mount ──────────────────────
  const { fillMesh, fillMat, edgeMesh, edgeMat, edgePosFlat, edgeColFlat, edgeGeo } = useMemo(() => {
    const fillMat = new THREE.MeshBasicMaterial({
      transparent: true,
      depthTest: true,
      depthWrite: false,
    })
    const fillMesh = new THREE.InstancedMesh(UNIT_BOX_GEO, fillMat, MAX_CUBOIDS)
    fillMesh.count = 0
    fillMesh.frustumCulled = false

    // Pre-allocated flat edge buffers — mutated in-place every update
    const edgePosFlat = new Float32Array(MAX_CUBOIDS * VERTS_PER_BOX * 3)
    const edgeColFlat = new Float32Array(MAX_CUBOIDS * VERTS_PER_BOX * 3)

    const edgePosAttr = new THREE.BufferAttribute(edgePosFlat, 3)
    const edgeColAttr = new THREE.BufferAttribute(edgeColFlat, 3)
    edgePosAttr.setUsage(THREE.DynamicDrawUsage)
    edgeColAttr.setUsage(THREE.DynamicDrawUsage)

    const edgeGeo = new THREE.BufferGeometry()
    edgeGeo.setAttribute('position', edgePosAttr)
    edgeGeo.setAttribute('color', edgeColAttr)
    edgeGeo.setDrawRange(0, 0)

    const edgeMat = new THREE.LineBasicMaterial({
      vertexColors: true,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
    })
    const edgeMesh = new THREE.LineSegments(edgeGeo, edgeMat)
    edgeMesh.frustumCulled = false

    return { fillMesh, fillMat, edgeMesh, edgeMat, edgePosFlat, edgeColFlat, edgeGeo }
  }, [])

  // Sync opacity / renderOrder (user-triggered, not per-frame)
  useLayoutEffect(() => {
    fillMat.opacity = style.opacity ?? 0.35
    fillMat.transparent = (style.opacity ?? 0.35) < 1
    fillMesh.renderOrder = style.renderOrder ?? 0
    edgeMesh.renderOrder = (style.renderOrder ?? 0) + 10
  }, [fillMesh, fillMat, edgeMesh, style.opacity, style.renderOrder])

  useEffect(() => {
    return () => {
      // UNIT_BOX_GEO is a shared singleton — never dispose it here.
      fillMat.dispose()
      edgeGeo.dispose()
      edgeMat.dispose()
    }
  }, [fillMat, edgeGeo, edgeMat])

  // ── Per-frame update — zero React subscriptions ─────────────────────────────
  const prevPayloadRef = useRef<CuboidPayload | undefined>(undefined)
  const prevVisibleRef = useRef(true)

  // ── Click handler: select object by trackId ────────────────────────────────
  const handleClick = useCallback((e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation()
    if (e.instanceId == null) return
    const payload = prevPayloadRef.current
    if (!payload || payload.type !== 'cuboid') return
    const trackId = payload.trackIds ? payload.trackIds[e.instanceId] : e.instanceId
    store.getState().setSelectedTrackId(trackId)
  }, [store])

  useFrame(() => {
    const group = groupRef.current
    if (!group) return

    const state     = store.getState()
    const sName     = nameRef.current
    const coordinate = state.streamsMeta[sName]?.coordinate ?? 'world'

    // Update coordinate transform in-place (avoids React reconciliation for matrix)
    if (coordinate === 'ego' && state.egoPose) {
      const { translation, rotation } = state.egoPose
      _egoPos.set(translation[0], translation[1], translation[2])
      _egoQuat.set(rotation[1], rotation[2], rotation[3], rotation[0])  // wxyz → xyzw
      _egoMat.compose(_egoPos, _egoQuat, _egoScale)
      group.matrix.copy(_egoMat)
    } else {
      group.matrix.identity()
    }
    group.matrixWorldNeedsUpdate = true

    const payload = state.streamState[sName] as CuboidPayload | undefined
    const visible  = state.visibleStreams[sName] ?? true

    // Gate: skip buffer update if payload reference and visibility haven't changed
    if (payload === prevPayloadRef.current && visible === prevVisibleRef.current) return
    prevPayloadRef.current = payload
    prevVisibleRef.current = visible

    if (!visible || !payload || payload.type !== 'cuboid') {
      fillMesh.count = 0
      edgeGeo.setDrawRange(0, 0)
      return
    }

    const count = Math.min(payload.count, MAX_CUBOIDS)
    fillMesh.count = count

    const s = styleRef.current
    const effectiveColor = s.styleFn
      ? (s.styleFn({ frameIndex: state.frameIndex, metrics: state.statistics?.metrics ?? null }).color ?? s.color)
      : s.color
    _col.set(effectiveColor ?? '#4b8cf8')
    const { r, g, b } = _col

    for (let i = 0; i < count; i++) {
      _pos.set(payload.centers[i * 3], payload.centers[i * 3 + 1], payload.centers[i * 3 + 2])
      // nuScenes rotation: [w, x, y, z] → THREE.Quaternion(x, y, z, w)
      _quat.set(
        payload.rotations[i * 4 + 1],
        payload.rotations[i * 4 + 2],
        payload.rotations[i * 4 + 3],
        payload.rotations[i * 4],
      )
      // nuScenes size: [width, length, height] → scale: x←length, y←width, z←height
      _scl.set(payload.sizes[i * 3 + 1], payload.sizes[i * 3], payload.sizes[i * 3 + 2])
      _mat4.compose(_pos, _quat, _scl)

      fillMesh.setMatrixAt(i, _mat4)
      fillMesh.setColorAt(i, _col)

      // Write world-space edge vertices into the flat buffer
      const base = i * VERTS_PER_BOX
      for (let v = 0; v < VERTS_PER_BOX; v++) {
        _v3.set(
          UNIT_EDGE_POSITIONS[v * 3],
          UNIT_EDGE_POSITIONS[v * 3 + 1],
          UNIT_EDGE_POSITIONS[v * 3 + 2],
        )
        _v3.applyMatrix4(_mat4)
        const off = (base + v) * 3
        edgePosFlat[off]     = _v3.x
        edgePosFlat[off + 1] = _v3.y
        edgePosFlat[off + 2] = _v3.z
        edgeColFlat[off]     = r
        edgeColFlat[off + 1] = g
        edgeColFlat[off + 2] = b
      }
    }

    fillMesh.instanceMatrix.needsUpdate = true
    if (fillMesh.instanceColor) fillMesh.instanceColor.needsUpdate = true

    const edgePosAttr = edgeGeo.getAttribute('position')
    const edgeColAttr = edgeGeo.getAttribute('color')
    if (edgePosAttr instanceof THREE.BufferAttribute) edgePosAttr.needsUpdate = true
    if (edgeColAttr instanceof THREE.BufferAttribute) edgeColAttr.needsUpdate = true
    edgeGeo.setDrawRange(0, count * VERTS_PER_BOX)
    if (count > 0) edgeGeo.computeBoundingSphere()
  })

  return (
    <group ref={groupRef} matrixAutoUpdate={false}>
      <primitive object={fillMesh} onClick={handleClick} />
      <primitive object={edgeMesh} />
    </group>
  )
}
