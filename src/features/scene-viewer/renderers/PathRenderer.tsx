import { useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { useFrame } from '@react-three/fiber'
import { useSceneStoreApi } from '../context'
import {
  createCoordinateTransformScratch,
  nextPowerOfTwo,
  updateCoordinateTransformInPlace
} from './rendererResources'
import type { EgoPose, PolylinePayload, StreamRendererProps } from '../types'

const MAX_RIBBON_VERTICES = 1_048_576

interface RibbonMeasure {
  pathCount: number
  vertexCount: number
  indexCount: number
  maxSegments: number
  truncated: boolean
}

function measureRibbons(payload: PolylinePayload): RibbonMeasure {
  let vertexCount = 0
  let indexCount = 0
  let maxSegments = 0
  let pathCount = 0

  for (; pathCount < payload.count; pathCount++) {
    const pointCount = payload.offsets[pathCount + 1] - payload.offsets[pathCount]
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
    truncated: pathCount < payload.count
  }
}

function buildRibbonsInPlace(
  payload: PolylinePayload,
  pathCount: number,
  position: Float32Array,
  colors: Float32Array,
  indices: Uint32Array,
  tangentX: Float32Array,
  tangentY: Float32Array,
  color: THREE.Color,
  lineWidth: number
): number {
  const { vertices, offsets } = payload
  const halfWidth = lineWidth * 0.5
  let vertexOffset = 0
  let indexOffset = 0

  for (let pathIndex = 0; pathIndex < pathCount; pathIndex++) {
    const start = offsets[pathIndex]
    const end = offsets[pathIndex + 1]
    const pointCount = end - start
    if (pointCount < 2) continue

    for (let segment = 0; segment < pointCount - 1; segment++) {
      const from = (start + segment) * 3
      const to = from + 3
      const dx = vertices[to] - vertices[from]
      const dy = vertices[to + 1] - vertices[from + 1]
      const length = Math.sqrt(dx * dx + dy * dy)
      tangentX[segment] = length > 1e-6 ? dx / length : 0
      tangentY[segment] = length > 1e-6 ? dy / length : 0
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
      position[left] = vertices[source] + normalX * halfWidth
      position[left + 1] = vertices[source + 1] + normalY * halfWidth
      position[left + 2] = vertices[source + 2]
      position[right] = vertices[source] - normalX * halfWidth
      position[right + 1] = vertices[source + 1] - normalY * halfWidth
      position[right + 2] = vertices[source + 2]
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

export function PathRenderer({ streamName, style }: StreamRendererProps) {
  const store = useSceneStoreApi()
  const groupRef = useRef<THREE.Group>(null)
  const styleRef = useRef(style)
  useLayoutEffect(() => {
    styleRef.current = style
  }, [style])

  const resources = useMemo(() => {
    const geometry = new THREE.BufferGeometry()
    const material = new THREE.MeshBasicMaterial({
      vertexColors: true,
      transparent: true,
      side: THREE.DoubleSide,
      depthWrite: false,
      depthTest: false
    })
    const mesh = new THREE.Mesh(geometry, material)
    mesh.frustumCulled = false
    return {
      geometry,
      material,
      mesh,
      vertexCapacity: 0,
      indexCapacity: 0,
      tangentCapacity: 0,
      tangentX: new Float32Array(0),
      tangentY: new Float32Array(0),
      color: new THREE.Color(),
      transformScratch: createCoordinateTransformScratch()
    }
  }, [])

  const previous = useRef<{
    payload?: PolylinePayload
    warnedPayload?: PolylinePayload
    visible: boolean
    coordinate: 'world' | 'ego'
    egoPose: EgoPose | null
    color?: string
    lineWidth?: number
    opacity: number
    renderOrder: number
  }>({
    visible: true,
    coordinate: 'world',
    egoPose: null,
    opacity: Number.NaN,
    renderOrder: Number.NaN
  })

  useFrame(() => {
    const group = groupRef.current
    if (!group) return

    const state = store.getState()
    const payload = state.streamState[streamName] as PolylinePayload | undefined
    const visible = state.visibleStreams[streamName] ?? true
    const coordinate = state.streamsMeta[streamName]?.coordinate ?? 'world'
    const currentStyle = styleRef.current
    const override = currentStyle.styleFn?.({
      frameIndex: state.frameIndex,
      metrics: state.statistics?.metrics ?? null
    })
    const color = override?.color ?? currentStyle.color ?? '#facc15'
    const lineWidth = override?.lineWidth ?? currentStyle.lineWidth ?? 0.5
    const opacity = override?.opacity ?? currentStyle.opacity ?? 1
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
      resources.mesh.visible = visible
      prev.visible = visible
    }
    if (opacity !== prev.opacity) {
      resources.material.opacity = opacity
      resources.material.transparent = opacity < 1
      resources.material.needsUpdate = true
      prev.opacity = opacity
    }
    if (renderOrder !== prev.renderOrder) {
      resources.mesh.renderOrder = renderOrder
      prev.renderOrder = renderOrder
    }

    if (payload === prev.payload && color === prev.color && lineWidth === prev.lineWidth) return
    prev.payload = payload
    prev.color = color
    prev.lineWidth = lineWidth

    if (!payload || payload.type !== 'polyline') {
      resources.geometry.setDrawRange(0, 0)
      return
    }

    const measure = measureRibbons(payload)
    if (measure.truncated && prev.warnedPayload !== payload) {
      console.warn(
        `[PathRenderer] ${streamName} exceeds ${MAX_RIBBON_VERTICES} ribbon vertices; remaining paths were skipped.`
      )
      prev.warnedPayload = payload
    }
    if (measure.vertexCount === 0 || measure.indexCount === 0) {
      resources.geometry.setDrawRange(0, 0)
      return
    }

    if (measure.vertexCount > resources.vertexCapacity) {
      resources.vertexCapacity = nextPowerOfTwo(measure.vertexCount)
      const position = new THREE.BufferAttribute(new Float32Array(resources.vertexCapacity * 3), 3)
      const colors = new THREE.BufferAttribute(new Float32Array(resources.vertexCapacity * 3), 3)
      position.setUsage(THREE.DynamicDrawUsage)
      colors.setUsage(THREE.DynamicDrawUsage)
      resources.geometry.setAttribute('position', position)
      resources.geometry.setAttribute('color', colors)
    }
    if (measure.indexCount > resources.indexCapacity) {
      resources.indexCapacity = nextPowerOfTwo(measure.indexCount)
      const indices = new THREE.BufferAttribute(new Uint32Array(resources.indexCapacity), 1)
      indices.setUsage(THREE.DynamicDrawUsage)
      resources.geometry.setIndex(indices)
    }
    if (measure.maxSegments > resources.tangentCapacity) {
      resources.tangentCapacity = nextPowerOfTwo(measure.maxSegments)
      resources.tangentX = new Float32Array(resources.tangentCapacity)
      resources.tangentY = new Float32Array(resources.tangentCapacity)
    }

    const position = resources.geometry.getAttribute('position') as THREE.BufferAttribute
    const colors = resources.geometry.getAttribute('color') as THREE.BufferAttribute
    const indices = resources.geometry.getIndex()
    if (!indices) {
      resources.geometry.setDrawRange(0, 0)
      return
    }

    resources.color.set(color)
    const indexCount = buildRibbonsInPlace(
      payload,
      measure.pathCount,
      position.array as Float32Array,
      colors.array as Float32Array,
      indices.array as Uint32Array,
      resources.tangentX,
      resources.tangentY,
      resources.color,
      lineWidth
    )
    position.needsUpdate = true
    colors.needsUpdate = true
    indices.needsUpdate = true
    resources.geometry.setDrawRange(0, indexCount)
    if (indexCount > 0) resources.geometry.computeBoundingSphere()
  })

  useEffect(
    () => () => {
      resources.geometry.dispose()
      resources.material.dispose()
    },
    [resources]
  )

  return (
    <group ref={groupRef} matrixAutoUpdate={false}>
      <primitive object={resources.mesh} />
    </group>
  )
}
