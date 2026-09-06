import { useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { useFrame } from '@react-three/fiber'
import { useSceneStoreApi } from '../context'
import {
  createCoordinateTransformScratch,
  updateCoordinateTransformInPlace
} from './layerTransform'
import type { EgoPose, PointPayload, StreamLayerProps } from '../types'

function nextPowerOfTwo(value: number): number {
  if (value <= 0) return 1
  let capacity = 1
  while (capacity < value) capacity <<= 1
  return capacity
}

export interface PointLayerData {
  points: Float32Array
  intensity: Float32Array | null
}

export interface PointLayerOptions {
  visible: boolean
  color: string
  opacity: number
  renderOrder: number
}

function intensityToRgb(value: number, target: Float32Array, offset: number): void {
  const normalized = value / 255
  if (normalized < 0.5) {
    const scale = normalized * 2
    target[offset] = 1
    target[offset + 1] = 1 - scale * (1 - 0.549)
    target[offset + 2] = 1 - scale
    return
  }

  const scale = (normalized - 0.5) * 2
  target[offset] = 1
  target[offset + 1] = 0.549 * (1 - scale)
  target[offset + 2] = 0
}

function createGeometry(capacity: number): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry()
  const position = new THREE.BufferAttribute(new Float32Array(capacity * 3), 3)
  const color = new THREE.BufferAttribute(new Float32Array(capacity * 3), 3)
  position.setUsage(THREE.DynamicDrawUsage)
  color.setUsage(THREE.DynamicDrawUsage)
  geometry.setAttribute('position', position)
  geometry.setAttribute('color', color)
  geometry.setDrawRange(0, 0)
  return geometry
}

export class PointPrimitive {
  readonly object: THREE.Points

  private readonly material: THREE.PointsMaterial
  private geometry: THREE.BufferGeometry
  private capacity = 1
  private readonly color = new THREE.Color()
  private previousData: PointLayerData | undefined
  private previousColor: string | undefined
  private previousVisible = true
  private previousOpacity = Number.NaN
  private previousRenderOrder = Number.NaN

  constructor() {
    this.material = new THREE.PointsMaterial({
      size: 0.1,
      vertexColors: true,
      sizeAttenuation: true
    })
    this.geometry = createGeometry(this.capacity)
    this.object = new THREE.Points(this.geometry, this.material)
    this.object.frustumCulled = false
  }

  update(data: PointLayerData | undefined, options: PointLayerOptions): void {
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

    if (data === this.previousData && (data?.intensity || options.color === this.previousColor)) {
      return
    }
    this.previousData = data
    this.previousColor = options.color

    const count = data ? Math.floor(data.points.length / 3) : 0
    if (count > this.capacity) {
      this.capacity = nextPowerOfTwo(count)
      const geometry = createGeometry(this.capacity)
      this.geometry.dispose()
      this.geometry = geometry
      this.object.geometry = geometry
    }

    const position = this.geometry.getAttribute('position') as THREE.BufferAttribute
    const colors = this.geometry.getAttribute('color') as THREE.BufferAttribute
    if (data && count > 0) {
      const positionArray = position.array as Float32Array
      const colorArray = colors.array as Float32Array
      positionArray.set(data.points.subarray(0, count * 3))

      if (data.intensity) {
        for (let index = 0; index < count; index++) {
          intensityToRgb(data.intensity[index] ?? 0, colorArray, index * 3)
        }
      } else {
        this.color.set(options.color)
        for (let index = 0; index < count; index++) {
          const offset = index * 3
          colorArray[offset] = this.color.r
          colorArray[offset + 1] = this.color.g
          colorArray[offset + 2] = this.color.b
        }
      }
      position.needsUpdate = true
      colors.needsUpdate = true
    }
    this.geometry.setDrawRange(0, count)
  }

  dispose(): void {
    this.geometry.dispose()
    this.material.dispose()
  }
}

export function PointLayer({ streamName, style }: StreamLayerProps) {
  const store = useSceneStoreApi()
  const groupRef = useRef<THREE.Group>(null)
  const styleRef = useRef(style)
  useLayoutEffect(() => {
    styleRef.current = style
  }, [style])

  const primitive = useMemo(() => new PointPrimitive(), [])
  const options = useMemo(
    () => ({ visible: true, color: '#ffffff', opacity: 1, renderOrder: 0 }),
    []
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
    const pointData = payload?.type === 'point' ? (payload as PointPayload) : undefined
    const currentStyle = styleRef.current
    const override = currentStyle.styleFn?.({
      frameIndex: state.displayedFrameIndex,
      metrics: state.statistics?.metrics ?? null
    })
    options.visible = state.visibleStreams[streamName] ?? true
    options.color = override?.color ?? currentStyle.color ?? '#ffffff'
    options.opacity = override?.opacity ?? currentStyle.opacity ?? 1
    options.renderOrder = override?.renderOrder ?? currentStyle.renderOrder ?? 0
    primitive.update(pointData, options)
  })

  useEffect(() => () => primitive.dispose(), [primitive])

  return (
    <group ref={groupRef} matrixAutoUpdate={false}>
      <primitive object={primitive.object} />
    </group>
  )
}
