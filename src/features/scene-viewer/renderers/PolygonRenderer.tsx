import { useMemo, useEffect, useLayoutEffect } from 'react'
import * as THREE from 'three'
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js'
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js'
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js'
import { useSceneStore, useSceneStoreApi } from '../context'
import { useCoordinateTransform } from '../hooks/useCoordinateTransform'
import { _col, useLineMaterialResolution } from './_shared'
import type { PolygonPayload, LayerRendererProps, StyleConfig } from '../types'

interface PolygonGeoSet {
  fillGeo: THREE.BufferGeometry | null
  outlinePositions: Float32Array
  outlineColors: Float32Array
}

function buildGeometries(
  payload: PolygonPayload,
  fillColor: string,
  outlineColor: string
): PolygonGeoSet {
  const { vertices, offsets, count } = payload

  // Pre-compute fill and outline colors once — no per-polygon color in PolygonPayload.
  _col.set(fillColor)
  const fr = _col.r,
    fg = _col.g,
    fb = _col.b
  _col.set(outlineColor)
  const or = _col.r,
    og = _col.g,
    ob = _col.b

  let totalFillVerts = 0,
    totalFillIndices = 0,
    totalOutlineFloats = 0

  // First pass: triangulate each polygon and calculate buffer sizes.
  const triSets: number[][] = []
  const vertCounts: number[] = []

  for (let i = 0; i < count; i++) {
    const start = offsets[i],
      end = offsets[i + 1]
    const vertCount = end - start
    if (vertCount < 3) {
      triSets.push([])
      vertCounts.push(0)
      continue
    }

    const pts2d: THREE.Vector2[] = []
    for (let j = start; j < end; j++) {
      pts2d.push(new THREE.Vector2(vertices[j * 3], vertices[j * 3 + 1]))
    }
    const faces = THREE.ShapeUtils.triangulateShape(pts2d, [])
    triSets.push(faces.flat())
    vertCounts.push(vertCount)
    totalFillVerts += vertCount
    totalFillIndices += faces.length * 3
    totalOutlineFloats += vertCount * 6
  }

  if (totalFillVerts === 0) {
    return {
      fillGeo: null,
      outlinePositions: new Float32Array(0),
      outlineColors: new Float32Array(0)
    }
  }

  const fillPositions = new Float32Array(totalFillVerts * 3)
  const fillColors = new Float32Array(totalFillVerts * 3)
  const fillIndices = new Uint32Array(totalFillIndices)
  const outlinePositions = new Float32Array(totalOutlineFloats)
  const outlineColors = new Float32Array(totalOutlineFloats)

  let vOff = 0,
    iOff = 0,
    outOff = 0

  for (let i = 0; i < count; i++) {
    const vertCount = vertCounts[i]
    if (vertCount === 0) continue

    const start = offsets[i]

    for (let j = 0; j < vertCount; j++) {
      const src = (start + j) * 3
      fillPositions[(vOff + j) * 3] = vertices[src]
      fillPositions[(vOff + j) * 3 + 1] = vertices[src + 1]
      fillPositions[(vOff + j) * 3 + 2] = vertices[src + 2]
      fillColors[(vOff + j) * 3] = fr
      fillColors[(vOff + j) * 3 + 1] = fg
      fillColors[(vOff + j) * 3 + 2] = fb
    }

    const faces = triSets[i]
    for (let j = 0; j < faces.length; j++) {
      fillIndices[iOff + j] = faces[j] + vOff
    }

    for (let j = 0; j < vertCount; j++) {
      const a = (start + j) * 3
      const b = (start + ((j + 1) % vertCount)) * 3
      outlinePositions[outOff] = vertices[a]
      outlinePositions[outOff + 1] = vertices[a + 1]
      outlinePositions[outOff + 2] = vertices[a + 2]
      outlinePositions[outOff + 3] = vertices[b]
      outlinePositions[outOff + 4] = vertices[b + 1]
      outlinePositions[outOff + 5] = vertices[b + 2]
      outlineColors[outOff] = or
      outlineColors[outOff + 1] = og
      outlineColors[outOff + 2] = ob
      outlineColors[outOff + 3] = or
      outlineColors[outOff + 4] = og
      outlineColors[outOff + 5] = ob
      outOff += 6
    }

    vOff += vertCount
    iOff += faces.length
  }

  const fillGeo = new THREE.BufferGeometry()
  fillGeo.setAttribute('position', new THREE.BufferAttribute(fillPositions, 3))
  fillGeo.setAttribute('color', new THREE.BufferAttribute(fillColors, 3))
  fillGeo.setIndex(new THREE.BufferAttribute(fillIndices, 1))

  return { fillGeo, outlinePositions, outlineColors }
}

export function PolygonRenderer({ streamName, style }: LayerRendererProps) {
  const store = useSceneStoreApi()
  const meta = useSceneStore(s => s.streamsMeta[streamName])
  const payload = useSceneStore(s => s.streamState[streamName]) as PolygonPayload | undefined
  const visible = useSceneStore(s => s.visibleStreams[streamName] ?? true)
  const frameIndex = useSceneStore(s => (style.styleFn != null ? s.frameIndex : 0))
  const matrix = useCoordinateTransform(meta?.coordinate ?? 'world')

  const effectiveStyle = useMemo<StyleConfig>(() => {
    if (!style.styleFn) return style
    const metrics = store.getState().statistics?.metrics ?? null
    return { ...style, ...style.styleFn({ frameIndex, metrics }) }
  }, [style, frameIndex, store])

  const fillColor = effectiveStyle.color ?? '#4488ff'
  const outlineColor = effectiveStyle.outlineColor ?? fillColor

  const geoSet = useMemo(
    () => (payload ? buildGeometries(payload, fillColor, outlineColor) : null),
    [payload, fillColor, outlineColor]
  )

  useEffect(() => () => geoSet?.fillGeo?.dispose(), [geoSet])

  const outlinePair = useMemo(() => {
    if (!geoSet || geoSet.outlinePositions.length === 0) return null

    const geo = new LineSegmentsGeometry()
    geo.setPositions(geoSet.outlinePositions)
    geo.setColors(geoSet.outlineColors)

    const mat = new LineMaterial({
      vertexColors: true,
      linewidth: effectiveStyle.outlineWidth ?? 1.5,
      resolution: new THREE.Vector2(1, 1),
      transparent: true,
      depthTest: false,
      depthWrite: false,
      toneMapped: false
    })

    const lines = new LineSegments2(geo, mat)
    lines.renderOrder = (effectiveStyle.renderOrder ?? 0) + 1
    return { lines, mat }
  }, [geoSet, effectiveStyle.outlineWidth, effectiveStyle.renderOrder])

  useLineMaterialResolution(outlinePair?.mat)

  useLayoutEffect(() => {
    if (outlinePair) outlinePair.lines.renderOrder = (effectiveStyle.renderOrder ?? 0) + 1
  }, [outlinePair, effectiveStyle.renderOrder])

  useEffect(() => {
    return () => {
      outlinePair?.lines.geometry.dispose()
      outlinePair?.mat.dispose()
    }
  }, [outlinePair])

  if (!visible || !geoSet) return null

  return (
    <group matrix={matrix} matrixAutoUpdate={false}>
      <group visible={visible}>
        {geoSet.fillGeo && (
          <mesh geometry={geoSet.fillGeo} renderOrder={effectiveStyle.renderOrder ?? 0}>
            <meshBasicMaterial
              vertexColors
              transparent
              opacity={effectiveStyle.opacity ?? 0.35}
              side={THREE.DoubleSide}
              depthWrite={false}
              depthTest={false}
            />
          </mesh>
        )}
        {outlinePair && <primitive object={outlinePair.lines} />}
      </group>
    </group>
  )
}
