import { useRef, useMemo, useEffect, useLayoutEffect, useCallback } from 'react'
import * as THREE from 'three'
import { useFrame, type ThreeEvent } from '@react-three/fiber'
import { useSceneStoreApi } from '../context'
import {
  createCoordinateTransformScratch,
  updateCoordinateTransformInPlace
} from './rendererResources'
import type { CuboidPayload, StreamRendererProps } from '../types'

// ─── Capacity ─────────────────────────────────────────────────────────────────

const MAX_CUBOIDS = 256
const VERTS_PER_BOX = 24 // 12 edges × 2 endpoints

// ─── Unit-cube edge table ─────────────────────────────────────────────────────

const UNIT_EDGE_CORNERS = [
  [-0.5, -0.5, -0.5],
  [+0.5, -0.5, -0.5],
  [+0.5, +0.5, -0.5],
  [-0.5, +0.5, -0.5],
  [-0.5, -0.5, +0.5],
  [+0.5, -0.5, +0.5],
  [+0.5, +0.5, +0.5],
  [-0.5, +0.5, +0.5]
] as const

const UNIT_EDGE_PAIRS = [
  [0, 1],
  [1, 2],
  [2, 3],
  [3, 0],
  [4, 5],
  [5, 6],
  [6, 7],
  [7, 4],
  [0, 4],
  [1, 5],
  [2, 6],
  [3, 7]
] as const

const UNIT_EDGE_POSITIONS: Float32Array = (() => {
  const buf = new Float32Array(VERTS_PER_BOX * 3)
  let w = 0
  for (const [a, b] of UNIT_EDGE_PAIRS) {
    buf[w++] = UNIT_EDGE_CORNERS[a][0]
    buf[w++] = UNIT_EDGE_CORNERS[a][1]
    buf[w++] = UNIT_EDGE_CORNERS[a][2]
    buf[w++] = UNIT_EDGE_CORNERS[b][0]
    buf[w++] = UNIT_EDGE_CORNERS[b][1]
    buf[w++] = UNIT_EDGE_CORNERS[b][2]
  }
  return buf
})()

// ─── Component ────────────────────────────────────────────────────────────────

export function CuboidRenderer({ streamName, style }: StreamRendererProps) {
  const store = useSceneStoreApi()
  const groupRef = useRef<THREE.Group>(null)
  const styleRef = useRef(style)
  const nameRef = useRef(streamName)
  useLayoutEffect(() => {
    styleRef.current = style
  }, [style])

  // ── Persistent Three.js objects created once per mount ──────────────────────
  const {
    unitBoxGeo,
    fillMesh,
    fillMat,
    edgeMesh,
    edgeMat,
    edgePosFlat,
    edgeColFlat,
    edgeGeo,
    color,
    vertex,
    matrix,
    position,
    quaternion,
    scale,
    transformScratch
  } = useMemo(() => {
    const unitBoxGeo = new THREE.BoxGeometry(1, 1, 1)
    const fillMat = new THREE.MeshBasicMaterial({
      transparent: true,
      depthTest: true,
      depthWrite: false
    })
    const fillMesh = new THREE.InstancedMesh(unitBoxGeo, fillMat, MAX_CUBOIDS)
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
      toneMapped: false
    })
    const edgeMesh = new THREE.LineSegments(edgeGeo, edgeMat)
    edgeMesh.frustumCulled = false

    return {
      unitBoxGeo,
      fillMesh,
      fillMat,
      edgeMesh,
      edgeMat,
      edgePosFlat,
      edgeColFlat,
      edgeGeo,
      color: new THREE.Color(),
      vertex: new THREE.Vector3(),
      matrix: new THREE.Matrix4(),
      position: new THREE.Vector3(),
      quaternion: new THREE.Quaternion(),
      scale: new THREE.Vector3(),
      transformScratch: createCoordinateTransformScratch()
    }
  }, [])

  useEffect(() => {
    return () => {
      unitBoxGeo.dispose()
      fillMat.dispose()
      edgeGeo.dispose()
      edgeMat.dispose()
    }
  }, [unitBoxGeo, fillMat, edgeGeo, edgeMat])

  // ── Per-frame update — zero React subscriptions ─────────────────────────────
  const prevPayloadRef = useRef<CuboidPayload | undefined>(undefined)
  const prevVisibleRef = useRef(true)
  const warnedPayloadRef = useRef<CuboidPayload | undefined>(undefined)
  const previousOpacityRef = useRef(Number.NaN)
  const previousRenderOrderRef = useRef(Number.NaN)
  const previousColorRef = useRef<string | undefined>(undefined)
  const previousCoordinateRef = useRef<'world' | 'ego'>('world')
  const previousEgoPoseRef = useRef(store.getState().egoPose)

  // ── Click handler: select object by trackId ────────────────────────────────
  const handleClick = useCallback(
    (e: ThreeEvent<MouseEvent>) => {
      e.stopPropagation()
      if (e.instanceId == null) return
      const payload = prevPayloadRef.current
      if (!payload || payload.type !== 'cuboid') return
      const trackId = payload.trackIds ? payload.trackIds[e.instanceId] : e.instanceId
      store.getState().setSelectedTrackId(trackId)
    },
    [store]
  )

  useFrame(() => {
    const group = groupRef.current
    if (!group) return

    const state = store.getState()
    const sName = nameRef.current
    const coordinate = state.streamsMeta[sName]?.coordinate ?? 'world'

    // Update coordinate transform in-place (avoids React reconciliation for matrix)
    if (
      coordinate !== previousCoordinateRef.current ||
      state.egoPose !== previousEgoPoseRef.current
    ) {
      updateCoordinateTransformInPlace(group.matrix, coordinate, state.egoPose, transformScratch)
      group.matrixWorldNeedsUpdate = true
      previousCoordinateRef.current = coordinate
      previousEgoPoseRef.current = state.egoPose
    }

    const payload = state.streamState[sName] as CuboidPayload | undefined
    const visible = state.visibleStreams[sName] ?? true

    const s = styleRef.current
    const override = s.styleFn?.({
      frameIndex: state.frameIndex,
      metrics: state.statistics?.metrics ?? null
    })
    const effectiveColor = override?.color ?? s.color ?? '#4b8cf8'
    const opacity = override?.opacity ?? s.opacity ?? 0.35
    const renderOrder = override?.renderOrder ?? s.renderOrder ?? 0
    if (opacity !== previousOpacityRef.current) {
      fillMat.opacity = opacity
      fillMat.transparent = opacity < 1
      previousOpacityRef.current = opacity
    }
    if (renderOrder !== previousRenderOrderRef.current) {
      fillMesh.renderOrder = renderOrder
      edgeMesh.renderOrder = renderOrder + 10
      previousRenderOrderRef.current = renderOrder
    }

    // Gate: skip buffer update if payload reference and visibility haven't changed.
    if (
      payload === prevPayloadRef.current &&
      visible === prevVisibleRef.current &&
      effectiveColor === previousColorRef.current
    ) {
      return
    }
    prevPayloadRef.current = payload
    prevVisibleRef.current = visible
    previousColorRef.current = effectiveColor

    if (!visible || !payload || payload.type !== 'cuboid') {
      fillMesh.count = 0
      edgeGeo.setDrawRange(0, 0)
      return
    }

    if (payload.count > MAX_CUBOIDS && warnedPayloadRef.current !== payload) {
      console.warn(
        `[CuboidRenderer] ${streamName} exceeds ${MAX_CUBOIDS} cuboids; remaining cuboids were skipped.`
      )
      warnedPayloadRef.current = payload
    }

    const count = Math.min(payload.count, MAX_CUBOIDS)
    fillMesh.count = count

    color.set(effectiveColor)
    const { r, g, b } = color

    for (let i = 0; i < count; i++) {
      position.set(payload.centers[i * 3], payload.centers[i * 3 + 1], payload.centers[i * 3 + 2])
      // nuScenes rotation: [w, x, y, z] → THREE.Quaternion(x, y, z, w)
      quaternion.set(
        payload.rotations[i * 4 + 1],
        payload.rotations[i * 4 + 2],
        payload.rotations[i * 4 + 3],
        payload.rotations[i * 4]
      )
      // nuScenes size: [width, length, height] → scale: x←length, y←width, z←height
      scale.set(payload.sizes[i * 3 + 1], payload.sizes[i * 3], payload.sizes[i * 3 + 2])
      matrix.compose(position, quaternion, scale)

      fillMesh.setMatrixAt(i, matrix)
      fillMesh.setColorAt(i, color)

      // Write world-space edge vertices into the flat buffer
      const base = i * VERTS_PER_BOX
      for (let v = 0; v < VERTS_PER_BOX; v++) {
        vertex.set(
          UNIT_EDGE_POSITIONS[v * 3],
          UNIT_EDGE_POSITIONS[v * 3 + 1],
          UNIT_EDGE_POSITIONS[v * 3 + 2]
        )
        vertex.applyMatrix4(matrix)
        const off = (base + v) * 3
        edgePosFlat[off] = vertex.x
        edgePosFlat[off + 1] = vertex.y
        edgePosFlat[off + 2] = vertex.z
        edgeColFlat[off] = r
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
