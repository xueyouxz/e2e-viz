import { useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { useFrame } from '@react-three/fiber'
import { useSceneStoreApi } from '../context'
import {
  createCoordinateTransformScratch,
  nextPowerOfTwo,
  updateCoordinateTransformInPlace
} from './rendererResources'
import type { EgoPose, PointPayload, StreamRendererProps } from '../types'

// White → orange → red heat colormap for intensity values in [0, 255].
function intensityToRgb(v: number, out: Float32Array, offset: number): void {
  const t = v / 255
  if (t < 0.5) {
    const s = t * 2
    out[offset] = 1
    out[offset + 1] = 1 - s * (1 - 0.549)
    out[offset + 2] = 1 - s
  } else {
    const s = (t - 0.5) * 2
    out[offset] = 1
    out[offset + 1] = 0.549 * (1 - s)
    out[offset + 2] = 0
  }
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

export function PointRenderer({ streamName, style }: StreamRendererProps) {
  const store = useSceneStoreApi()
  const groupRef = useRef<THREE.Group>(null)
  const styleRef = useRef(style)
  useLayoutEffect(() => {
    styleRef.current = style
  }, [style])

  const resources = useMemo(() => {
    const material = new THREE.PointsMaterial({
      size: 0.1,
      vertexColors: true,
      sizeAttenuation: true
    })
    const geometry = createGeometry(1)
    const points = new THREE.Points(geometry, material)
    points.frustumCulled = false
    return {
      points,
      material,
      geometry,
      capacity: 1,
      color: new THREE.Color(),
      transformScratch: createCoordinateTransformScratch()
    }
  }, [])

  const previous = useRef<{
    payload?: PointPayload
    visible: boolean
    coordinate: 'world' | 'ego'
    egoPose: EgoPose | null
    color?: string
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
    const payload = state.streamState[streamName] as PointPayload | undefined
    const visible = state.visibleStreams[streamName] ?? true
    const coordinate = state.streamsMeta[streamName]?.coordinate ?? 'world'
    const currentStyle = styleRef.current
    const override = currentStyle.styleFn?.({
      frameIndex: state.frameIndex,
      metrics: state.statistics?.metrics ?? null
    })
    const color = override?.color ?? currentStyle.color ?? '#ffffff'
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
      resources.points.visible = visible
      prev.visible = visible
    }

    if (opacity !== prev.opacity) {
      resources.material.opacity = opacity
      resources.material.transparent = opacity < 1
      resources.material.needsUpdate = true
      prev.opacity = opacity
    }
    if (renderOrder !== prev.renderOrder) {
      resources.points.renderOrder = renderOrder
      prev.renderOrder = renderOrder
    }

    if (payload === prev.payload && (payload?.intensity || color === prev.color)) return
    prev.payload = payload
    prev.color = color

    const count = payload?.type === 'point' ? Math.floor(payload.points.length / 3) : 0
    if (count > resources.capacity) {
      const capacity = nextPowerOfTwo(count)
      const geometry = createGeometry(capacity)
      resources.geometry.dispose()
      resources.geometry = geometry
      resources.capacity = capacity
      resources.points.geometry = geometry
    }

    const position = resources.geometry.getAttribute('position') as THREE.BufferAttribute
    const colors = resources.geometry.getAttribute('color') as THREE.BufferAttribute
    if (payload?.type === 'point' && count > 0) {
      const positionArray = position.array as Float32Array
      const colorArray = colors.array as Float32Array
      positionArray.set(payload.points.subarray(0, count * 3))

      if (payload.intensity) {
        for (let i = 0; i < count; i++) {
          intensityToRgb(payload.intensity[i] ?? 0, colorArray, i * 3)
        }
      } else {
        resources.color.set(color)
        for (let i = 0; i < count; i++) {
          const offset = i * 3
          colorArray[offset] = resources.color.r
          colorArray[offset + 1] = resources.color.g
          colorArray[offset + 2] = resources.color.b
        }
      }
      position.needsUpdate = true
      colors.needsUpdate = true
    }
    resources.geometry.setDrawRange(0, count)
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
      <primitive object={resources.points} />
    </group>
  )
}
