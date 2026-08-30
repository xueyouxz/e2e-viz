import { useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { useFrame } from '@react-three/fiber'
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js'
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js'
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js'
import { useSceneStoreApi } from '../context'
import {
  createCoordinateTransformScratch,
  nextPowerOfTwo,
  updateCoordinateTransformInPlace,
  useLineMaterialResolution
} from './rendererResources'
import type { EgoPose, LayerRendererProps, PolygonPayload } from '../types'

function createDynamicAttribute(length: number, itemSize: number): THREE.BufferAttribute {
  const attribute = new THREE.BufferAttribute(new Float32Array(length), itemSize)
  attribute.setUsage(THREE.DynamicDrawUsage)
  return attribute
}

export function PolygonRenderer({ streamName, style }: LayerRendererProps) {
  const store = useSceneStoreApi()
  const groupRef = useRef<THREE.Group>(null)
  const styleRef = useRef(style)
  useLayoutEffect(() => {
    styleRef.current = style
  }, [style])

  const resources = useMemo(() => {
    const fillGeometry = new THREE.BufferGeometry()
    fillGeometry.setDrawRange(0, 0)
    const fillMaterial = new THREE.MeshBasicMaterial({
      vertexColors: true,
      transparent: true,
      side: THREE.DoubleSide,
      depthWrite: false,
      depthTest: false
    })
    const fillMesh = new THREE.Mesh(fillGeometry, fillMaterial)
    fillMesh.frustumCulled = false

    const outlineGeometry = new LineSegmentsGeometry()
    outlineGeometry.instanceCount = 0
    const outlineMaterial = new LineMaterial({
      vertexColors: true,
      resolution: new THREE.Vector2(1, 1),
      transparent: true,
      depthTest: false,
      depthWrite: false,
      toneMapped: false
    })
    const outlineLines = new LineSegments2(outlineGeometry, outlineMaterial)
    outlineLines.frustumCulled = false

    const container = new THREE.Group()
    container.add(fillMesh, outlineLines)

    return {
      container,
      fillGeometry,
      fillMaterial,
      fillMesh,
      outlineGeometry,
      outlineMaterial,
      outlineLines,
      fillVertexCapacity: 0,
      fillIndexCapacity: 0,
      outlineSegmentCapacity: 0,
      outlinePositionBuffer: null as THREE.InstancedInterleavedBuffer | null,
      outlineColorBuffer: null as THREE.InstancedInterleavedBuffer | null,
      fillColor: new THREE.Color(),
      outlineColor: new THREE.Color(),
      points2d: [] as THREE.Vector2[],
      holes: [] as THREE.Vector2[][],
      transformScratch: createCoordinateTransformScratch()
    }
  }, [])
  useLineMaterialResolution(resources.outlineMaterial)

  const previous = useRef<{
    payload?: PolygonPayload
    visible: boolean
    coordinate: 'world' | 'ego'
    egoPose: EgoPose | null
    fillColor?: string
    outlineColor?: string
    opacity: number
    outlineWidth: number
    renderOrder: number
  }>({
    visible: true,
    coordinate: 'world',
    egoPose: null,
    opacity: Number.NaN,
    outlineWidth: Number.NaN,
    renderOrder: Number.NaN
  })

  useFrame(() => {
    const group = groupRef.current
    if (!group) return

    const state = store.getState()
    const payload = state.streamState[streamName] as PolygonPayload | undefined
    const visible = state.visibleStreams[streamName] ?? true
    const coordinate = state.streamsMeta[streamName]?.coordinate ?? 'world'
    const currentStyle = styleRef.current
    const override = currentStyle.styleFn?.({
      frameIndex: state.frameIndex,
      metrics: state.statistics?.metrics ?? null
    })
    const fillColor = override?.color ?? currentStyle.color ?? '#4488ff'
    const outlineColor = override?.outlineColor ?? currentStyle.outlineColor ?? fillColor
    const opacity = override?.opacity ?? currentStyle.opacity ?? 0.35
    const outlineWidth = override?.outlineWidth ?? currentStyle.outlineWidth ?? 1.5
    const renderOrder = override?.renderOrder ?? currentStyle.renderOrder ?? 0
    const prev = previous.current

    if (coordinate !== prev.coordinate || state.egoPose !== prev.egoPose) {
      updateCoordinateTransformInPlace(
        group.matrix,
        coordinate,
        state.egoPose,
        resources.transformScratch
      )
      group.matrixWorldNeedsUpdate = true
      prev.coordinate = coordinate
      prev.egoPose = state.egoPose
    }
    if (visible !== prev.visible) {
      resources.container.visible = visible
      prev.visible = visible
    }
    if (opacity !== prev.opacity) {
      resources.fillMaterial.opacity = opacity
      resources.fillMaterial.needsUpdate = true
      prev.opacity = opacity
    }
    if (outlineWidth !== prev.outlineWidth) {
      resources.outlineMaterial.linewidth = outlineWidth
      prev.outlineWidth = outlineWidth
    }
    if (renderOrder !== prev.renderOrder) {
      resources.fillMesh.renderOrder = renderOrder
      resources.outlineLines.renderOrder = renderOrder + 1
      prev.renderOrder = renderOrder
    }

    if (
      payload === prev.payload &&
      fillColor === prev.fillColor &&
      outlineColor === prev.outlineColor
    ) {
      return
    }
    prev.payload = payload
    prev.fillColor = fillColor
    prev.outlineColor = outlineColor

    if (!payload || payload.type !== 'polygon') {
      resources.fillGeometry.setDrawRange(0, 0)
      resources.outlineGeometry.instanceCount = 0
      return
    }

    let fillVertexCount = 0
    let maximumIndexCount = 0
    let outlineSegmentCount = 0
    for (let polygon = 0; polygon < payload.count; polygon++) {
      const vertexCount = payload.offsets[polygon + 1] - payload.offsets[polygon]
      if (vertexCount < 3) continue
      fillVertexCount += vertexCount
      maximumIndexCount += (vertexCount - 2) * 3
      outlineSegmentCount += vertexCount
    }

    if (fillVertexCount === 0) {
      resources.fillGeometry.setDrawRange(0, 0)
      resources.outlineGeometry.instanceCount = 0
      return
    }

    if (fillVertexCount > resources.fillVertexCapacity) {
      resources.fillVertexCapacity = nextPowerOfTwo(fillVertexCount)
      resources.fillGeometry.setAttribute(
        'position',
        createDynamicAttribute(resources.fillVertexCapacity * 3, 3)
      )
      resources.fillGeometry.setAttribute(
        'color',
        createDynamicAttribute(resources.fillVertexCapacity * 3, 3)
      )
    }
    if (maximumIndexCount > resources.fillIndexCapacity) {
      resources.fillIndexCapacity = nextPowerOfTwo(maximumIndexCount)
      const index = new THREE.BufferAttribute(new Uint32Array(resources.fillIndexCapacity), 1)
      index.setUsage(THREE.DynamicDrawUsage)
      resources.fillGeometry.setIndex(index)
    }
    if (outlineSegmentCount > resources.outlineSegmentCapacity) {
      resources.outlineSegmentCapacity = nextPowerOfTwo(outlineSegmentCount)
      const positions = new THREE.InstancedInterleavedBuffer(
        new Float32Array(resources.outlineSegmentCapacity * 6),
        6,
        1
      )
      const colors = new THREE.InstancedInterleavedBuffer(
        new Float32Array(resources.outlineSegmentCapacity * 6),
        6,
        1
      )
      positions.setUsage(THREE.DynamicDrawUsage)
      colors.setUsage(THREE.DynamicDrawUsage)
      resources.outlineGeometry.setAttribute(
        'instanceStart',
        new THREE.InterleavedBufferAttribute(positions, 3, 0)
      )
      resources.outlineGeometry.setAttribute(
        'instanceEnd',
        new THREE.InterleavedBufferAttribute(positions, 3, 3)
      )
      resources.outlineGeometry.setAttribute(
        'instanceColorStart',
        new THREE.InterleavedBufferAttribute(colors, 3, 0)
      )
      resources.outlineGeometry.setAttribute(
        'instanceColorEnd',
        new THREE.InterleavedBufferAttribute(colors, 3, 3)
      )
      resources.outlinePositionBuffer = positions
      resources.outlineColorBuffer = colors
    }

    const fillPosition = resources.fillGeometry.getAttribute('position') as THREE.BufferAttribute
    const fillColors = resources.fillGeometry.getAttribute('color') as THREE.BufferAttribute
    const fillIndex = resources.fillGeometry.getIndex()
    const outlinePositions = resources.outlinePositionBuffer
    const outlineColors = resources.outlineColorBuffer
    if (!fillIndex || !outlinePositions || !outlineColors) return

    const vertices = payload.vertices
    const fillPositionArray = fillPosition.array as Float32Array
    const fillColorArray = fillColors.array as Float32Array
    const fillIndexArray = fillIndex.array as Uint32Array
    const outlinePositionArray = outlinePositions.array
    const outlineColorArray = outlineColors.array
    resources.fillColor.set(fillColor)
    resources.outlineColor.set(outlineColor)

    let fillVertexOffset = 0
    let fillIndexOffset = 0
    let outlineOffset = 0
    for (let polygon = 0; polygon < payload.count; polygon++) {
      const start = payload.offsets[polygon]
      const end = payload.offsets[polygon + 1]
      const vertexCount = end - start
      if (vertexCount < 3) continue

      while (resources.points2d.length < vertexCount) {
        resources.points2d.push(new THREE.Vector2())
      }
      resources.points2d.length = vertexCount
      for (let vertex = 0; vertex < vertexCount; vertex++) {
        const source = (start + vertex) * 3
        resources.points2d[vertex].set(vertices[source], vertices[source + 1])

        const fillOffset = (fillVertexOffset + vertex) * 3
        fillPositionArray[fillOffset] = vertices[source]
        fillPositionArray[fillOffset + 1] = vertices[source + 1]
        fillPositionArray[fillOffset + 2] = vertices[source + 2]
        fillColorArray[fillOffset] = resources.fillColor.r
        fillColorArray[fillOffset + 1] = resources.fillColor.g
        fillColorArray[fillOffset + 2] = resources.fillColor.b

        const nextSource = (start + ((vertex + 1) % vertexCount)) * 3
        outlinePositionArray[outlineOffset] = vertices[source]
        outlinePositionArray[outlineOffset + 1] = vertices[source + 1]
        outlinePositionArray[outlineOffset + 2] = vertices[source + 2]
        outlinePositionArray[outlineOffset + 3] = vertices[nextSource]
        outlinePositionArray[outlineOffset + 4] = vertices[nextSource + 1]
        outlinePositionArray[outlineOffset + 5] = vertices[nextSource + 2]
        outlineColorArray[outlineOffset] = resources.outlineColor.r
        outlineColorArray[outlineOffset + 1] = resources.outlineColor.g
        outlineColorArray[outlineOffset + 2] = resources.outlineColor.b
        outlineColorArray[outlineOffset + 3] = resources.outlineColor.r
        outlineColorArray[outlineOffset + 4] = resources.outlineColor.g
        outlineColorArray[outlineOffset + 5] = resources.outlineColor.b
        outlineOffset += 6
      }

      const faces = THREE.ShapeUtils.triangulateShape(resources.points2d, resources.holes)
      for (const face of faces) {
        fillIndexArray[fillIndexOffset++] = fillVertexOffset + face[0]
        fillIndexArray[fillIndexOffset++] = fillVertexOffset + face[1]
        fillIndexArray[fillIndexOffset++] = fillVertexOffset + face[2]
      }
      fillVertexOffset += vertexCount
    }

    fillPosition.needsUpdate = true
    fillColors.needsUpdate = true
    fillIndex.needsUpdate = true
    resources.fillGeometry.setDrawRange(0, fillIndexOffset)
    resources.fillGeometry.computeBoundingSphere()
    outlinePositions.needsUpdate = true
    outlineColors.needsUpdate = true
    resources.outlineGeometry.instanceCount = outlineSegmentCount
    resources.outlineGeometry.computeBoundingSphere()
  })

  useEffect(
    () => () => {
      resources.fillGeometry.dispose()
      resources.fillMaterial.dispose()
      resources.outlineGeometry.dispose()
      resources.outlineMaterial.dispose()
    },
    [resources]
  )

  return (
    <group ref={groupRef} matrixAutoUpdate={false}>
      <primitive object={resources.container} />
    </group>
  )
}
