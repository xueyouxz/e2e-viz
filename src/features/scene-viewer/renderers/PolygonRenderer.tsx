import { useMemo } from 'react'
import { PolygonLayer } from '../layer'
import type { PolygonLayerDatum } from '../layer'
import { useSceneStore, useSceneStoreApi } from '../context'
import { useCoordinateTransform } from '../hooks/useCoordinateTransform'
import type { PolygonPayload, LayerRendererProps, StyleConfig } from '../types'

function toPolygonData(payload: PolygonPayload): PolygonLayerDatum[] {
  const result: PolygonLayerDatum[] = []
  for (let i = 0; i < payload.count; i++) {
    const start = payload.offsets[i]
    const end = payload.offsets[i + 1]
    const vertices: [number, number, number][] = []
    for (let j = start; j < end; j++) {
      vertices.push([payload.vertices[j * 3], payload.vertices[j * 3 + 1], payload.vertices[j * 3 + 2]])
    }
    if (vertices.length >= 3) result.push({ vertices })
  }
  return result
}

export function PolygonRenderer({ streamName, style }: LayerRendererProps) {
  const store = useSceneStoreApi()
  const meta = useSceneStore((s) => s.streamsMeta[streamName])
  const payload = useSceneStore((s) => s.streamState[streamName]) as PolygonPayload | undefined
  const visible = useSceneStore((s) => s.visibleStreams[streamName] ?? true)
  const frameIndex = useSceneStore((s) => style.styleFn != null ? s.frameIndex : 0)
  const matrix = useCoordinateTransform(meta?.coordinate ?? 'world')

  const effectiveStyle = useMemo<StyleConfig>(() => {
    if (!style.styleFn) return style
    const metrics = store.getState().statistics?.metrics ?? null
    return { ...style, ...style.styleFn({ frameIndex, metrics }) }
  }, [style, frameIndex, store])

  const data = useMemo<PolygonLayerDatum[]>(
    () => (payload ? toPolygonData(payload) : []),
    [payload],
  )

  if (!visible || !payload || data.length === 0) return null

  return (
    <group matrix={matrix} matrixAutoUpdate={false}>
      <PolygonLayer
        data={data}
        color={effectiveStyle.color}
        outlineColor={effectiveStyle.outlineColor}
        opacity={effectiveStyle.opacity}
        outlineWidth={effectiveStyle.outlineWidth}
        visible={visible}
        renderOrder={effectiveStyle.renderOrder}
      />
    </group>
  )
}
