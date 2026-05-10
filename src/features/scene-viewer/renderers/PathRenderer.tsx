import { useMemo } from 'react'
import { PathLayer } from '../layer'
import type { PathLayerDatum } from '../layer'
import { useSceneStore, useSceneStoreApi } from '../context'
import { useCoordinateTransform } from '../hooks/useCoordinateTransform'
import type { PolylinePayload, LayerRendererProps, StyleConfig } from '../types'

function toPathData(payload: PolylinePayload): PathLayerDatum[] {
  const result: PathLayerDatum[] = []
  for (let i = 0; i < payload.count; i++) {
    const start = payload.offsets[i]
    const end = payload.offsets[i + 1]
    const positions: [number, number, number][] = []
    for (let j = start; j < end; j++) {
      positions.push([payload.vertices[j * 3], payload.vertices[j * 3 + 1], payload.vertices[j * 3 + 2]])
    }
    if (positions.length >= 2) result.push({ positions })
  }
  return result
}

export function PathRenderer({ streamName, style }: LayerRendererProps) {
  const store = useSceneStoreApi()
  const meta = useSceneStore((s) => s.streamsMeta[streamName])
  const payload = useSceneStore((s) => s.streamState[streamName]) as PolylinePayload | undefined
  const visible = useSceneStore((s) => s.visibleStreams[streamName] ?? true)
  // Only subscribe to frameIndex when styleFn is present — avoids per-frame re-renders otherwise.
  const frameIndex = useSceneStore((s) => style.styleFn != null ? s.frameIndex : 0)
  const matrix = useCoordinateTransform(meta?.coordinate ?? 'world')

  const effectiveStyle = useMemo<StyleConfig>(() => {
    if (!style.styleFn) return style
    const metrics = store.getState().statistics?.metrics ?? null
    return { ...style, ...style.styleFn({ frameIndex, metrics }) }
  }, [style, frameIndex, store])

  const data = useMemo<PathLayerDatum[]>(
    () => (payload ? toPathData(payload) : []),
    [payload],
  )

  if (!visible || !payload || data.length === 0) return null

  return (
    <group matrix={matrix} matrixAutoUpdate={false}>
      <PathLayer
        data={data}
        color={effectiveStyle.color}
        opacity={effectiveStyle.opacity}
        lineWidth={effectiveStyle.lineWidth}
        visible={visible}
        renderOrder={effectiveStyle.renderOrder}
      />
    </group>
  )
}
