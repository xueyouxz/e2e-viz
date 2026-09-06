import { useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { useFrame, useThree } from '@react-three/fiber'
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js'
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js'
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js'
import { useSceneStoreApi } from '../context'
import {
  createCoordinateTransformScratch,
  updateCoordinateTransformInPlace
} from './layerTransform'
import type { EgoPose, PolygonPayload, StreamLayerProps } from '../types'

function nextPowerOfTwo(value: number): number {
  if (value <= 0) return 1
  let capacity = 1
  while (capacity < value) capacity <<= 1
  return capacity
}

export interface PolygonLayerData {
  vertices: Float32Array
  offsets: Uint32Array
  count: number
}

export interface PolygonLayerOptions {
  visible: boolean
  color: string
  outlineColor: string
  opacity: number
  outlineWidth: number
  renderOrder: number
}

function createDynamicAttribute(length: number, itemSize: number): THREE.BufferAttribute {
  const attribute = new THREE.BufferAttribute(new Float32Array(length), itemSize)
  attribute.setUsage(THREE.DynamicDrawUsage)
  return attribute
}

export class PolygonPrimitive {
  readonly object: THREE.Group

  private readonly fillGeometry = new THREE.BufferGeometry()
  private readonly fillMaterial = new THREE.MeshBasicMaterial({
    vertexColors: true,
    transparent: true,
    side: THREE.DoubleSide,
    depthWrite: false,
    depthTest: false
  })
  private readonly fillMesh = new THREE.Mesh(this.fillGeometry, this.fillMaterial)
  private readonly outlineGeometry = new LineSegmentsGeometry()
  private readonly outlineMaterial = new LineMaterial({
    vertexColors: true,
    resolution: new THREE.Vector2(1, 1),
    transparent: true,
    depthTest: false,
    depthWrite: false,
    toneMapped: false
  })
  private readonly outlineLines = new LineSegments2(this.outlineGeometry, this.outlineMaterial)
  private fillVertexCapacity = 0
  private fillIndexCapacity = 0
  private outlineSegmentCapacity = 0
  private outlinePositionBuffer: THREE.InstancedInterleavedBuffer | null = null
  private outlineColorBuffer: THREE.InstancedInterleavedBuffer | null = null
  private readonly fillColor = new THREE.Color()
  private readonly outlineColor = new THREE.Color()
  private readonly points2d: THREE.Vector2[] = []
  private readonly holes: THREE.Vector2[][] = []
  private previousData: PolygonLayerData | undefined
  private previousFillColor: string | undefined
  private previousOutlineColor: string | undefined
  private previousVisible = true
  private previousOpacity = Number.NaN
  private previousOutlineWidth = Number.NaN
  private previousRenderOrder = Number.NaN

  constructor() {
    this.fillGeometry.setDrawRange(0, 0)
    this.fillMesh.frustumCulled = false
    this.outlineGeometry.instanceCount = 0
    this.outlineLines.frustumCulled = false
    this.object = new THREE.Group()
    this.object.add(this.fillMesh, this.outlineLines)
  }

  setResolution(width: number, height: number): void {
    this.outlineMaterial.resolution.set(width, height)
  }

  update(data: PolygonLayerData | undefined, options: PolygonLayerOptions): void {
    if (options.visible !== this.previousVisible) {
      this.object.visible = options.visible
      this.previousVisible = options.visible
    }
    if (options.opacity !== this.previousOpacity) {
      this.fillMaterial.opacity = options.opacity
      this.fillMaterial.needsUpdate = true
      this.previousOpacity = options.opacity
    }
    if (options.outlineWidth !== this.previousOutlineWidth) {
      this.outlineMaterial.linewidth = options.outlineWidth
      this.previousOutlineWidth = options.outlineWidth
    }
    if (options.renderOrder !== this.previousRenderOrder) {
      this.fillMesh.renderOrder = options.renderOrder
      this.outlineLines.renderOrder = options.renderOrder + 1
      this.previousRenderOrder = options.renderOrder
    }

    if (
      data === this.previousData &&
      options.color === this.previousFillColor &&
      options.outlineColor === this.previousOutlineColor
    ) {
      return
    }
    this.previousData = data
    this.previousFillColor = options.color
    this.previousOutlineColor = options.outlineColor

    if (!data) {
      this.clear()
      return
    }

    let fillVertexCount = 0
    let maximumIndexCount = 0
    let outlineSegmentCount = 0
    for (let polygon = 0; polygon < data.count; polygon++) {
      const vertexCount = data.offsets[polygon + 1] - data.offsets[polygon]
      if (vertexCount < 3) continue
      fillVertexCount += vertexCount
      maximumIndexCount += (vertexCount - 2) * 3
      outlineSegmentCount += vertexCount
    }

    if (fillVertexCount === 0) {
      this.clear()
      return
    }

    this.ensureFillCapacity(fillVertexCount, maximumIndexCount)
    this.ensureOutlineCapacity(outlineSegmentCount)

    const fillPosition = this.fillGeometry.getAttribute('position') as THREE.BufferAttribute
    const fillColors = this.fillGeometry.getAttribute('color') as THREE.BufferAttribute
    const fillIndex = this.fillGeometry.getIndex()
    const outlinePositions = this.outlinePositionBuffer
    const outlineColors = this.outlineColorBuffer
    if (!fillIndex || !outlinePositions || !outlineColors) return

    const fillPositionArray = fillPosition.array as Float32Array
    const fillColorArray = fillColors.array as Float32Array
    const fillIndexArray = fillIndex.array as Uint32Array
    const outlinePositionArray = outlinePositions.array
    const outlineColorArray = outlineColors.array
    this.fillColor.set(options.color)
    this.outlineColor.set(options.outlineColor)

    let fillVertexOffset = 0
    let fillIndexOffset = 0
    let outlineOffset = 0
    for (let polygon = 0; polygon < data.count; polygon++) {
      const start = data.offsets[polygon]
      const end = data.offsets[polygon + 1]
      const vertexCount = end - start
      if (vertexCount < 3) continue

      while (this.points2d.length < vertexCount) this.points2d.push(new THREE.Vector2())
      this.points2d.length = vertexCount
      for (let vertex = 0; vertex < vertexCount; vertex++) {
        const source = (start + vertex) * 3
        this.points2d[vertex].set(data.vertices[source], data.vertices[source + 1])

        const fillOffset = (fillVertexOffset + vertex) * 3
        fillPositionArray[fillOffset] = data.vertices[source]
        fillPositionArray[fillOffset + 1] = data.vertices[source + 1]
        fillPositionArray[fillOffset + 2] = data.vertices[source + 2]
        fillColorArray[fillOffset] = this.fillColor.r
        fillColorArray[fillOffset + 1] = this.fillColor.g
        fillColorArray[fillOffset + 2] = this.fillColor.b

        const nextSource = (start + ((vertex + 1) % vertexCount)) * 3
        outlinePositionArray[outlineOffset] = data.vertices[source]
        outlinePositionArray[outlineOffset + 1] = data.vertices[source + 1]
        outlinePositionArray[outlineOffset + 2] = data.vertices[source + 2]
        outlinePositionArray[outlineOffset + 3] = data.vertices[nextSource]
        outlinePositionArray[outlineOffset + 4] = data.vertices[nextSource + 1]
        outlinePositionArray[outlineOffset + 5] = data.vertices[nextSource + 2]
        outlineColorArray[outlineOffset] = this.outlineColor.r
        outlineColorArray[outlineOffset + 1] = this.outlineColor.g
        outlineColorArray[outlineOffset + 2] = this.outlineColor.b
        outlineColorArray[outlineOffset + 3] = this.outlineColor.r
        outlineColorArray[outlineOffset + 4] = this.outlineColor.g
        outlineColorArray[outlineOffset + 5] = this.outlineColor.b
        outlineOffset += 6
      }

      const faces = THREE.ShapeUtils.triangulateShape(this.points2d, this.holes)
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
    this.fillGeometry.setDrawRange(0, fillIndexOffset)
    this.fillGeometry.computeBoundingSphere()
    outlinePositions.needsUpdate = true
    outlineColors.needsUpdate = true
    this.outlineGeometry.instanceCount = outlineSegmentCount
    this.outlineGeometry.computeBoundingSphere()
  }

  dispose(): void {
    this.fillGeometry.dispose()
    this.fillMaterial.dispose()
    this.outlineGeometry.dispose()
    this.outlineMaterial.dispose()
  }

  private clear(): void {
    this.fillGeometry.setDrawRange(0, 0)
    this.outlineGeometry.instanceCount = 0
  }

  private ensureFillCapacity(vertexCount: number, indexCount: number): void {
    if (vertexCount > this.fillVertexCapacity) {
      this.fillVertexCapacity = nextPowerOfTwo(vertexCount)
      this.fillGeometry.setAttribute(
        'position',
        createDynamicAttribute(this.fillVertexCapacity * 3, 3)
      )
      this.fillGeometry.setAttribute(
        'color',
        createDynamicAttribute(this.fillVertexCapacity * 3, 3)
      )
    }
    if (indexCount > this.fillIndexCapacity) {
      this.fillIndexCapacity = nextPowerOfTwo(indexCount)
      const index = new THREE.BufferAttribute(new Uint32Array(this.fillIndexCapacity), 1)
      index.setUsage(THREE.DynamicDrawUsage)
      this.fillGeometry.setIndex(index)
    }
  }

  private ensureOutlineCapacity(segmentCount: number): void {
    if (segmentCount <= this.outlineSegmentCapacity) return

    this.outlineSegmentCapacity = nextPowerOfTwo(segmentCount)
    const positions = new THREE.InstancedInterleavedBuffer(
      new Float32Array(this.outlineSegmentCapacity * 6),
      6,
      1
    )
    const colors = new THREE.InstancedInterleavedBuffer(
      new Float32Array(this.outlineSegmentCapacity * 6),
      6,
      1
    )
    positions.setUsage(THREE.DynamicDrawUsage)
    colors.setUsage(THREE.DynamicDrawUsage)
    this.outlineGeometry.setAttribute(
      'instanceStart',
      new THREE.InterleavedBufferAttribute(positions, 3, 0)
    )
    this.outlineGeometry.setAttribute(
      'instanceEnd',
      new THREE.InterleavedBufferAttribute(positions, 3, 3)
    )
    this.outlineGeometry.setAttribute(
      'instanceColorStart',
      new THREE.InterleavedBufferAttribute(colors, 3, 0)
    )
    this.outlineGeometry.setAttribute(
      'instanceColorEnd',
      new THREE.InterleavedBufferAttribute(colors, 3, 3)
    )
    this.outlinePositionBuffer = positions
    this.outlineColorBuffer = colors
  }
}

export function PolygonLayer({ streamName, style }: StreamLayerProps) {
  const store = useSceneStoreApi()
  const groupRef = useRef<THREE.Group>(null)
  const styleRef = useRef(style)
  useLayoutEffect(() => {
    styleRef.current = style
  }, [style])

  const primitive = useMemo(() => new PolygonPrimitive(), [])
  const options = useMemo(
    () => ({
      visible: true,
      color: '#4488ff',
      outlineColor: '#4488ff',
      opacity: 0.35,
      outlineWidth: 1.5,
      renderOrder: 0
    }),
    []
  )
  const transformScratch = useMemo(createCoordinateTransformScratch, [])
  const previousTransform = useRef<{
    coordinate: 'world' | 'ego'
    egoPose: EgoPose | null
  }>({ coordinate: 'world', egoPose: null })
  const { size } = useThree()
  useLayoutEffect(() => {
    primitive.setResolution(size.width, size.height)
  }, [primitive, size.height, size.width])

  useFrame(() => {
    const group = groupRef.current
    if (!group) return

    const state = store.getState()
    const coordinate = state.streamsMeta[streamName]?.coordinate ?? 'world'
    const previous = previousTransform.current
    if (coordinate !== previous.coordinate || state.egoPose !== previous.egoPose) {
      updateCoordinateTransformInPlace(group.matrix, coordinate, state.egoPose, transformScratch)
      group.matrixWorldNeedsUpdate = true
      previous.coordinate = coordinate
      previous.egoPose = state.egoPose
    }

    const payload = state.streamState[streamName]
    const polygonData = payload?.type === 'polygon' ? (payload as PolygonPayload) : undefined
    const currentStyle = styleRef.current
    const override = currentStyle.styleFn?.({
      frameIndex: state.displayedFrameIndex,
      metrics: state.statistics?.metrics ?? null
    })
    const color = override?.color ?? currentStyle.color ?? '#4488ff'
    options.visible = state.visibleStreams[streamName] ?? true
    options.color = color
    options.outlineColor = override?.outlineColor ?? currentStyle.outlineColor ?? color
    options.opacity = override?.opacity ?? currentStyle.opacity ?? 0.35
    options.outlineWidth = override?.outlineWidth ?? currentStyle.outlineWidth ?? 1.5
    options.renderOrder = override?.renderOrder ?? currentStyle.renderOrder ?? 0
    primitive.update(polygonData, options)
  })

  useEffect(() => () => primitive.dispose(), [primitive])

  return (
    <group ref={groupRef} matrixAutoUpdate={false}>
      <primitive object={primitive.object} />
    </group>
  )
}
