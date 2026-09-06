import { useCallback, useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { useFrame, type ThreeEvent } from '@react-three/fiber'
import { useSceneStoreApi } from '../context'
import {
  createCoordinateTransformScratch,
  updateCoordinateTransformInPlace
} from './layerTransform'
import type { CuboidPayload, EgoPose, StreamLayerProps } from '../types'

const MAX_CUBOIDS = 256
const VERTICES_PER_BOX = 24

const UNIT_CORNERS = [
  [-0.5, -0.5, -0.5],
  [+0.5, -0.5, -0.5],
  [+0.5, +0.5, -0.5],
  [-0.5, +0.5, -0.5],
  [-0.5, -0.5, +0.5],
  [+0.5, -0.5, +0.5],
  [+0.5, +0.5, +0.5],
  [-0.5, +0.5, +0.5]
] as const

const EDGE_PAIRS = [
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

const UNIT_EDGE_POSITIONS = (() => {
  const positions = new Float32Array(VERTICES_PER_BOX * 3)
  let offset = 0
  for (const [start, end] of EDGE_PAIRS) {
    positions[offset++] = UNIT_CORNERS[start][0]
    positions[offset++] = UNIT_CORNERS[start][1]
    positions[offset++] = UNIT_CORNERS[start][2]
    positions[offset++] = UNIT_CORNERS[end][0]
    positions[offset++] = UNIT_CORNERS[end][1]
    positions[offset++] = UNIT_CORNERS[end][2]
  }
  return positions
})()

export interface CuboidLayerData {
  centers: Float32Array
  sizes: Float32Array
  rotations: Float32Array
  count: number
}

export interface CuboidLayerOptions {
  visible: boolean
  color: string
  opacity: number
  renderOrder: number
}

export class CuboidPrimitive {
  readonly maxCount = MAX_CUBOIDS
  readonly fillObject: THREE.InstancedMesh
  readonly outlineObject: THREE.LineSegments

  private readonly unitGeometry = new THREE.BoxGeometry(1, 1, 1)
  private readonly fillMaterial = new THREE.MeshBasicMaterial({
    transparent: true,
    depthTest: true,
    depthWrite: false
  })
  private readonly outlineGeometry = new THREE.BufferGeometry()
  private readonly outlineMaterial = new THREE.LineBasicMaterial({
    vertexColors: true,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    toneMapped: false
  })
  private readonly outlinePositions = new Float32Array(MAX_CUBOIDS * VERTICES_PER_BOX * 3)
  private readonly outlineColors = new Float32Array(MAX_CUBOIDS * VERTICES_PER_BOX * 3)
  private readonly color = new THREE.Color()
  private readonly vertex = new THREE.Vector3()
  private readonly matrix = new THREE.Matrix4()
  private readonly position = new THREE.Vector3()
  private readonly quaternion = new THREE.Quaternion()
  private readonly scale = new THREE.Vector3()
  private previousData: CuboidLayerData | undefined
  private previousColor: string | undefined
  private previousVisible = true
  private previousOpacity = Number.NaN
  private previousRenderOrder = Number.NaN

  constructor() {
    const position = new THREE.BufferAttribute(this.outlinePositions, 3)
    const color = new THREE.BufferAttribute(this.outlineColors, 3)
    position.setUsage(THREE.DynamicDrawUsage)
    color.setUsage(THREE.DynamicDrawUsage)
    this.outlineGeometry.setAttribute('position', position)
    this.outlineGeometry.setAttribute('color', color)
    this.outlineGeometry.setDrawRange(0, 0)

    this.fillObject = new THREE.InstancedMesh(this.unitGeometry, this.fillMaterial, MAX_CUBOIDS)
    this.fillObject.count = 0
    this.fillObject.frustumCulled = false

    this.outlineObject = new THREE.LineSegments(this.outlineGeometry, this.outlineMaterial)
    this.outlineObject.frustumCulled = false
  }

  update(data: CuboidLayerData | undefined, options: CuboidLayerOptions): void {
    const visibilityChanged = options.visible !== this.previousVisible
    if (visibilityChanged) {
      this.fillObject.visible = options.visible
      this.outlineObject.visible = options.visible
      this.previousVisible = options.visible
    }
    if (options.opacity !== this.previousOpacity) {
      this.fillMaterial.opacity = options.opacity
      this.fillMaterial.transparent = options.opacity < 1
      this.fillMaterial.needsUpdate = true
      this.previousOpacity = options.opacity
    }
    if (options.renderOrder !== this.previousRenderOrder) {
      this.fillObject.renderOrder = options.renderOrder
      this.outlineObject.renderOrder = options.renderOrder + 10
      this.previousRenderOrder = options.renderOrder
    }

    if (data === this.previousData && options.color === this.previousColor && !visibilityChanged) {
      return
    }
    this.previousData = data
    this.previousColor = options.color

    if (!options.visible || !data) {
      this.clear()
      return
    }

    const count = Math.min(data.count, MAX_CUBOIDS)
    this.fillObject.count = count
    this.color.set(options.color)

    for (let index = 0; index < count; index++) {
      const centerOffset = index * 3
      const rotationOffset = index * 4
      this.position.set(
        data.centers[centerOffset],
        data.centers[centerOffset + 1],
        data.centers[centerOffset + 2]
      )
      this.quaternion.set(
        data.rotations[rotationOffset + 1],
        data.rotations[rotationOffset + 2],
        data.rotations[rotationOffset + 3],
        data.rotations[rotationOffset]
      )
      this.scale.set(
        data.sizes[centerOffset + 1],
        data.sizes[centerOffset],
        data.sizes[centerOffset + 2]
      )
      this.matrix.compose(this.position, this.quaternion, this.scale)
      this.fillObject.setMatrixAt(index, this.matrix)
      this.fillObject.setColorAt(index, this.color)

      const vertexBase = index * VERTICES_PER_BOX
      for (let vertexIndex = 0; vertexIndex < VERTICES_PER_BOX; vertexIndex++) {
        const unitOffset = vertexIndex * 3
        this.vertex
          .set(
            UNIT_EDGE_POSITIONS[unitOffset],
            UNIT_EDGE_POSITIONS[unitOffset + 1],
            UNIT_EDGE_POSITIONS[unitOffset + 2]
          )
          .applyMatrix4(this.matrix)

        const targetOffset = (vertexBase + vertexIndex) * 3
        this.outlinePositions[targetOffset] = this.vertex.x
        this.outlinePositions[targetOffset + 1] = this.vertex.y
        this.outlinePositions[targetOffset + 2] = this.vertex.z
        this.outlineColors[targetOffset] = this.color.r
        this.outlineColors[targetOffset + 1] = this.color.g
        this.outlineColors[targetOffset + 2] = this.color.b
      }
    }

    this.fillObject.instanceMatrix.needsUpdate = true
    if (this.fillObject.instanceColor) this.fillObject.instanceColor.needsUpdate = true
    const positions = this.outlineGeometry.getAttribute('position')
    const colors = this.outlineGeometry.getAttribute('color')
    positions.needsUpdate = true
    colors.needsUpdate = true
    this.outlineGeometry.setDrawRange(0, count * VERTICES_PER_BOX)
    if (count > 0) this.outlineGeometry.computeBoundingSphere()
  }

  dispose(): void {
    this.unitGeometry.dispose()
    this.fillMaterial.dispose()
    this.outlineGeometry.dispose()
    this.outlineMaterial.dispose()
  }

  private clear(): void {
    this.fillObject.count = 0
    this.outlineGeometry.setDrawRange(0, 0)
  }
}

export function CuboidLayer({ streamName, style }: StreamLayerProps) {
  const store = useSceneStoreApi()
  const groupRef = useRef<THREE.Group>(null)
  const styleRef = useRef(style)
  useLayoutEffect(() => {
    styleRef.current = style
  }, [style])

  const primitive = useMemo(() => new CuboidPrimitive(), [])
  const options = useMemo(
    () => ({ visible: true, color: '#4b8cf8', opacity: 0.35, renderOrder: 0 }),
    []
  )
  const transformScratch = useMemo(createCoordinateTransformScratch, [])
  const previousTransform = useRef<{
    coordinate: 'world' | 'ego'
    egoPose: EgoPose | null
  }>({ coordinate: 'world', egoPose: null })
  const payloadRef = useRef<CuboidPayload | undefined>(undefined)
  const warnedPayloadRef = useRef<CuboidPayload | undefined>(undefined)

  const handleClick = useCallback(
    (event: ThreeEvent<MouseEvent>) => {
      event.stopPropagation()
      if (event.instanceId == null) return
      const payload = payloadRef.current
      if (!payload) return
      const trackId = payload.trackIds?.[event.instanceId] ?? event.instanceId
      store.getState().setSelectedTrackId(trackId)
    },
    [store]
  )

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
    const cuboidData = payload?.type === 'cuboid' ? (payload as CuboidPayload) : undefined
    payloadRef.current = cuboidData

    const currentStyle = styleRef.current
    const override = currentStyle.styleFn?.({
      frameIndex: state.displayedFrameIndex,
      metrics: state.statistics?.metrics ?? null
    })
    options.visible = state.visibleStreams[streamName] ?? true
    options.color = override?.color ?? currentStyle.color ?? '#4b8cf8'
    options.opacity = override?.opacity ?? currentStyle.opacity ?? 0.35
    options.renderOrder = override?.renderOrder ?? currentStyle.renderOrder ?? 0

    if (
      options.visible &&
      cuboidData &&
      cuboidData.count > primitive.maxCount &&
      warnedPayloadRef.current !== cuboidData
    ) {
      console.warn(
        `[CuboidLayer] ${streamName} exceeds ${primitive.maxCount} cuboids; remaining cuboids were skipped.`
      )
      warnedPayloadRef.current = cuboidData
    }

    primitive.update(cuboidData, options)
  })

  useEffect(() => () => primitive.dispose(), [primitive])

  return (
    <group ref={groupRef} matrixAutoUpdate={false}>
      <primitive object={primitive.fillObject} onClick={handleClick} />
      <primitive object={primitive.outlineObject} />
    </group>
  )
}
