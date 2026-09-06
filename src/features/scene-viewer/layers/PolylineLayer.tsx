import { useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { useFrame } from '@react-three/fiber'
import { useSceneStoreApi } from '../context'
import {
  createCoordinateTransformScratch,
  updateCoordinateTransformInPlace
} from './layerTransform'
import type { EgoPose, PolylinePayload, StreamLayerProps } from '../types'

const MAX_RIBBON_VERTICES = 1_048_576

function nextPowerOfTwo(value: number): number {
  if (value <= 0) return 1
  let capacity = 1
  while (capacity < value) capacity <<= 1
  return capacity
}

export interface PolylineLayerData {
  vertices: Float32Array
  offsets: Uint32Array
  count: number
}

export interface PolylineLayerOptions {
  visible: boolean
  color: string
  lineWidth: number
  opacity: number
  renderOrder: number
  name?: string
}

interface RibbonMeasure {
  pathCount: number
  vertexCount: number
  indexCount: number
  maxSegments: number
  truncated: boolean
}

function measureRibbons(data: PolylineLayerData): RibbonMeasure {
  let vertexCount = 0
  let indexCount = 0
  let maxSegments = 0
  let pathCount = 0

  for (; pathCount < data.count; pathCount++) {
    const pointCount = data.offsets[pathCount + 1] - data.offsets[pathCount]
    if (pointCount < 2) continue
    if (vertexCount + pointCount * 2 > MAX_RIBBON_VERTICES) break
    vertexCount += pointCount * 2
    indexCount += (pointCount - 1) * 6
    maxSegments = Math.max(maxSegments, pointCount - 1)
  }

  return {
    pathCount,
    vertexCount,
    indexCount,
    maxSegments,
    truncated: pathCount < data.count
  }
}

function buildRibbonsInPlace(
  data: PolylineLayerData,
  pathCount: number,
  position: Float32Array,
  colors: Float32Array,
  indices: Uint32Array,
  tangentX: Float32Array,
  tangentY: Float32Array,
  color: THREE.Color,
  lineWidth: number
): number {
  const halfWidth = lineWidth * 0.5
  let vertexOffset = 0
  let indexOffset = 0

  for (let pathIndex = 0; pathIndex < pathCount; pathIndex++) {
    const start = data.offsets[pathIndex]
    const end = data.offsets[pathIndex + 1]
    const pointCount = end - start
    if (pointCount < 2) continue

    for (let segment = 0; segment < pointCount - 1; segment++) {
      const from = (start + segment) * 3
      const to = from + 3
      const deltaX = data.vertices[to] - data.vertices[from]
      const deltaY = data.vertices[to + 1] - data.vertices[from + 1]
      const length = Math.sqrt(deltaX * deltaX + deltaY * deltaY)
      tangentX[segment] = length > 1e-6 ? deltaX / length : 0
      tangentY[segment] = length > 1e-6 ? deltaY / length : 0
    }

    const baseVertex = vertexOffset
    for (let point = 0; point < pointCount; point++) {
      const source = (start + point) * 3
      let normalX: number
      let normalY: number
      if (point === 0) {
        normalX = -tangentY[0]
        normalY = tangentX[0]
      } else if (point === pointCount - 1) {
        normalX = -tangentY[pointCount - 2]
        normalY = tangentX[pointCount - 2]
      } else {
        const averageX = tangentX[point - 1] + tangentX[point]
        const averageY = tangentY[point - 1] + tangentY[point]
        const length = Math.sqrt(averageX * averageX + averageY * averageY)
        normalX = length > 1e-6 ? -averageY / length : -tangentY[point]
        normalY = length > 1e-6 ? averageX / length : tangentX[point]
      }

      const left = vertexOffset * 3
      const right = left + 3
      position[left] = data.vertices[source] + normalX * halfWidth
      position[left + 1] = data.vertices[source + 1] + normalY * halfWidth
      position[left + 2] = data.vertices[source + 2]
      position[right] = data.vertices[source] - normalX * halfWidth
      position[right + 1] = data.vertices[source + 1] - normalY * halfWidth
      position[right + 2] = data.vertices[source + 2]
      for (let component = 0; component < 2; component++) {
        const offset = (vertexOffset + component) * 3
        colors[offset] = color.r
        colors[offset + 1] = color.g
        colors[offset + 2] = color.b
      }
      vertexOffset += 2
    }

    for (let point = 0; point < pointCount - 1; point++) {
      const left = baseVertex + point * 2
      const right = left + 1
      indices[indexOffset++] = left
      indices[indexOffset++] = right
      indices[indexOffset++] = left + 2
      indices[indexOffset++] = right
      indices[indexOffset++] = right + 2
      indices[indexOffset++] = left + 2
    }
  }

  return indexOffset
}

export class PolylinePrimitive {
  readonly object: THREE.Mesh

  private readonly material: THREE.MeshBasicMaterial
  private readonly geometry: THREE.BufferGeometry
  private vertexCapacity = 0
  private indexCapacity = 0
  private tangentCapacity = 0
  private tangentX = new Float32Array(0)
  private tangentY = new Float32Array(0)
  private readonly color = new THREE.Color()
  private previousData: PolylineLayerData | undefined
  private warnedData: PolylineLayerData | undefined
  private previousColor: string | undefined
  private previousLineWidth: number | undefined
  private previousVisible = true
  private previousOpacity = Number.NaN
  private previousRenderOrder = Number.NaN

  constructor() {
    this.geometry = new THREE.BufferGeometry()
    this.material = new THREE.MeshBasicMaterial({
      vertexColors: true,
      transparent: true,
      side: THREE.DoubleSide,
      depthWrite: false,
      depthTest: false
    })
    this.object = new THREE.Mesh(this.geometry, this.material)
    this.object.frustumCulled = false
  }

  update(data: PolylineLayerData | undefined, options: PolylineLayerOptions): void {
    if (options.visible !== this.previousVisible) {
      this.object.visible = options.visible
      this.previousVisible = options.visible
    }
    if (options.opacity !== this.previousOpacity) {
      this.material.opacity = options.opacity
      this.material.transparent = options.opacity < 1
      this.material.needsUpdate = true
      this.previousOpacity = options.opacity
    }
    if (options.renderOrder !== this.previousRenderOrder) {
      this.object.renderOrder = options.renderOrder
      this.previousRenderOrder = options.renderOrder
    }

    if (
      data === this.previousData &&
      options.color === this.previousColor &&
      options.lineWidth === this.previousLineWidth
    ) {
      return
    }
    this.previousData = data
    this.previousColor = options.color
    this.previousLineWidth = options.lineWidth

    if (!data) {
      this.geometry.setDrawRange(0, 0)
      return
    }

    const measure = measureRibbons(data)
    if (measure.truncated && this.warnedData !== data) {
      const name = options.name ? ` ${options.name}` : ''
      console.warn(
        `[PolylineLayer]${name} exceeds ${MAX_RIBBON_VERTICES} ribbon vertices; remaining paths were skipped.`
      )
      this.warnedData = data
    }
    if (measure.vertexCount === 0 || measure.indexCount === 0) {
      this.geometry.setDrawRange(0, 0)
      return
    }

    if (measure.vertexCount > this.vertexCapacity) {
      this.vertexCapacity = nextPowerOfTwo(measure.vertexCount)
      const position = new THREE.BufferAttribute(new Float32Array(this.vertexCapacity * 3), 3)
      const colors = new THREE.BufferAttribute(new Float32Array(this.vertexCapacity * 3), 3)
      position.setUsage(THREE.DynamicDrawUsage)
      colors.setUsage(THREE.DynamicDrawUsage)
      this.geometry.setAttribute('position', position)
      this.geometry.setAttribute('color', colors)
    }
    if (measure.indexCount > this.indexCapacity) {
      this.indexCapacity = nextPowerOfTwo(measure.indexCount)
      const indices = new THREE.BufferAttribute(new Uint32Array(this.indexCapacity), 1)
      indices.setUsage(THREE.DynamicDrawUsage)
      this.geometry.setIndex(indices)
    }
    if (measure.maxSegments > this.tangentCapacity) {
      this.tangentCapacity = nextPowerOfTwo(measure.maxSegments)
      this.tangentX = new Float32Array(this.tangentCapacity)
      this.tangentY = new Float32Array(this.tangentCapacity)
    }

    const position = this.geometry.getAttribute('position') as THREE.BufferAttribute
    const colors = this.geometry.getAttribute('color') as THREE.BufferAttribute
    const indices = this.geometry.getIndex()
    if (!indices) {
      this.geometry.setDrawRange(0, 0)
      return
    }

    this.color.set(options.color)
    const indexCount = buildRibbonsInPlace(
      data,
      measure.pathCount,
      position.array as Float32Array,
      colors.array as Float32Array,
      indices.array as Uint32Array,
      this.tangentX,
      this.tangentY,
      this.color,
      options.lineWidth
    )
    position.needsUpdate = true
    colors.needsUpdate = true
    indices.needsUpdate = true
    this.geometry.setDrawRange(0, indexCount)
    if (indexCount > 0) this.geometry.computeBoundingSphere()
  }

  dispose(): void {
    this.geometry.dispose()
    this.material.dispose()
  }
}

export function PolylineLayer({ streamName, style }: StreamLayerProps) {
  const store = useSceneStoreApi()
  const groupRef = useRef<THREE.Group>(null)
  const styleRef = useRef(style)
  useLayoutEffect(() => {
    styleRef.current = style
  }, [style])

  const primitive = useMemo(() => new PolylinePrimitive(), [])
  const options = useMemo(
    () => ({
      visible: true,
      color: '#facc15',
      lineWidth: 0.5,
      opacity: 1,
      renderOrder: 0,
      name: streamName
    }),
    [streamName]
  )
  const transformScratch = useMemo(createCoordinateTransformScratch, [])
  const previousTransform = useRef<{
    coordinate: 'world' | 'ego'
    egoPose: EgoPose | null
  }>({ coordinate: 'world', egoPose: null })

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
    const polylineData = payload?.type === 'polyline' ? (payload as PolylinePayload) : undefined
    const currentStyle = styleRef.current
    const override = currentStyle.styleFn?.({
      frameIndex: state.displayedFrameIndex,
      metrics: state.statistics?.metrics ?? null
    })
    options.visible = state.visibleStreams[streamName] ?? true
    options.color = override?.color ?? currentStyle.color ?? '#facc15'
    options.lineWidth = override?.lineWidth ?? currentStyle.lineWidth ?? 0.5
    options.opacity = override?.opacity ?? currentStyle.opacity ?? 1
    options.renderOrder = override?.renderOrder ?? currentStyle.renderOrder ?? 0
    primitive.update(polylineData, options)
  })

  useEffect(() => () => primitive.dispose(), [primitive])

  return (
    <group ref={groupRef} matrixAutoUpdate={false}>
      <primitive object={primitive.object} />
    </group>
  )
}
