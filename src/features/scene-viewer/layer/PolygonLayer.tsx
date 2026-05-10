import { useMemo, useEffect, useLayoutEffect } from 'react'
import * as THREE from 'three'
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js'
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js'
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js'
import { normalizeDatum, useLineMaterialResolution, _col } from './_shared'
import type { PolygonLayerDatum, LayerBaseProps } from './types'

export interface PolygonLayerProps extends LayerBaseProps {
  data: PolygonLayerDatum | PolygonLayerDatum[]
  /** Fill colour for all polygons (per-datum `color` takes precedence) */
  color?: string
  /** Outline edge colour; falls back to `color` when omitted */
  outlineColor?: string
  /** Whether to render filled faces */
  showFill?: boolean
  /** Whether to render outline edges */
  showOutline?: boolean
  /** Outline line width in pixels */
  outlineWidth?: number
}

interface TriEntry {
  faces: number[][]
  fillColor: THREE.Color
  outlineColor: THREE.Color
  vertCount: number
  idxCount: number
}

interface PolygonGeoSet {
  fillGeo: THREE.BufferGeometry | null
  outlinePositions: Float32Array
  outlineColors: Float32Array
}

function buildGeometries(
  items: PolygonLayerDatum[],
  fallbackFillColor: string,
  fallbackOutlineColor: string,
): PolygonGeoSet {
  const valid = items.filter(item => item.vertices.length >= 3)

  if (valid.length === 0) {
    return { fillGeo: null, outlinePositions: new Float32Array(0), outlineColors: new Float32Array(0) }
  }

  const entries: TriEntry[] = []
  let totalFillVerts     = 0
  let totalFillIndices   = 0
  let totalOutlineFloats = 0

  for (const item of valid) {
    const verts = item.vertices
    const pts2d = verts.map(v => new THREE.Vector2(v[0], v[1]))
    const faces = THREE.ShapeUtils.triangulateShape(pts2d, [])

    _col.set(item.color ?? fallbackFillColor)
    const fillColor = _col.clone()
    _col.set(item.color ?? fallbackOutlineColor)
    const outlineColor = _col.clone()

    entries.push({
      faces,
      fillColor,
      outlineColor,
      vertCount: verts.length,
      idxCount: faces.length * 3,
    })

    totalFillVerts     += verts.length
    totalFillIndices   += faces.length * 3
    totalOutlineFloats += verts.length * 6
  }

  const fillPositions    = new Float32Array(totalFillVerts * 3)
  const fillColors       = new Float32Array(totalFillVerts * 3)
  const fillIndices      = new Uint32Array(totalFillIndices)
  const outlinePositions = new Float32Array(totalOutlineFloats)
  const outlineColors    = new Float32Array(totalOutlineFloats)

  let vOff = 0, iOff = 0, outOff = 0

  for (let e = 0; e < entries.length; e++) {
    const { faces, fillColor, outlineColor, vertCount } = entries[e]
    const verts = valid[e].vertices

    for (let j = 0; j < vertCount; j++) {
      const v = verts[j]
      fillPositions[(vOff + j) * 3]     = v[0]
      fillPositions[(vOff + j) * 3 + 1] = v[1]
      fillPositions[(vOff + j) * 3 + 2] = v[2]
    }

    for (let j = 0; j < vertCount; j++) {
      fillColors[(vOff + j) * 3]     = fillColor.r
      fillColors[(vOff + j) * 3 + 1] = fillColor.g
      fillColors[(vOff + j) * 3 + 2] = fillColor.b
    }

    for (let j = 0; j < faces.length; j++) {
      fillIndices[iOff + j * 3]     = faces[j][0] + vOff
      fillIndices[iOff + j * 3 + 1] = faces[j][1] + vOff
      fillIndices[iOff + j * 3 + 2] = faces[j][2] + vOff
    }

    for (let i = 0; i < verts.length; i++) {
      const a = verts[i]
      const b = verts[(i + 1) % verts.length]
      outlinePositions[outOff]     = a[0]; outlinePositions[outOff + 1] = a[1]; outlinePositions[outOff + 2] = a[2]
      outlinePositions[outOff + 3] = b[0]; outlinePositions[outOff + 4] = b[1]; outlinePositions[outOff + 5] = b[2]
      outlineColors[outOff]     = outlineColor.r; outlineColors[outOff + 1] = outlineColor.g; outlineColors[outOff + 2] = outlineColor.b
      outlineColors[outOff + 3] = outlineColor.r; outlineColors[outOff + 4] = outlineColor.g; outlineColors[outOff + 5] = outlineColor.b
      outOff += 6
    }

    vOff += vertCount
    iOff += faces.length * 3
  }

  const fillGeo = new THREE.BufferGeometry()
  fillGeo.setAttribute('position', new THREE.BufferAttribute(fillPositions, 3))
  fillGeo.setAttribute('color',    new THREE.BufferAttribute(fillColors,    3))
  fillGeo.setIndex(new THREE.BufferAttribute(fillIndices, 1))

  return { fillGeo, outlinePositions, outlineColors }
}

export function PolygonLayer({
  data,
  color = '#4488ff',
  outlineColor,
  opacity = 0.35,
  showFill = true,
  showOutline = true,
  outlineWidth = 1.5,
  visible = true,
  renderOrder = 0,
}: PolygonLayerProps) {
  const items = useMemo(() => normalizeDatum(data), [data])

  const resolvedOutlineColor = outlineColor ?? color
  const geoSet = useMemo(
    () => buildGeometries(items, color, resolvedOutlineColor),
    [items, color, resolvedOutlineColor],
  )

  useEffect(() => () => geoSet.fillGeo?.dispose(), [geoSet])

  const outlinePair = useMemo(() => {
    if (!showOutline || geoSet.outlinePositions.length === 0) return null

    const geo = new LineSegmentsGeometry()
    geo.setPositions(geoSet.outlinePositions)
    geo.setColors(geoSet.outlineColors)

    // resolution is set to (1,1) here; useLineMaterialResolution syncs it immediately.
    const mat = new LineMaterial({
      vertexColors: true,
      linewidth: outlineWidth,
      resolution: new THREE.Vector2(1, 1),
      transparent: true,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
    })

    const lines = new LineSegments2(geo, mat)
    lines.renderOrder = renderOrder + 1
    return { lines, mat }
  }, [geoSet.outlinePositions, geoSet.outlineColors, outlineWidth, showOutline, renderOrder])

  // Keeps mat.resolution in sync with canvas size — replaces the size dep above.
  useLineMaterialResolution(outlinePair?.mat)

  useLayoutEffect(() => {
    if (outlinePair) outlinePair.lines.renderOrder = renderOrder + 1
  }, [outlinePair, renderOrder])

  useEffect(() => {
    return () => {
      outlinePair?.lines.geometry.dispose()
      outlinePair?.mat.dispose()
    }
  }, [outlinePair])

  return (
    <group visible={visible}>
      {showFill && geoSet.fillGeo && (
        <mesh geometry={geoSet.fillGeo} renderOrder={renderOrder}>
          <meshBasicMaterial
            vertexColors
            transparent
            opacity={opacity}
            side={THREE.DoubleSide}
            depthWrite={false}
            depthTest={false}
          />
        </mesh>
      )}
      {outlinePair && <primitive object={outlinePair.lines} />}
    </group>
  )
}
