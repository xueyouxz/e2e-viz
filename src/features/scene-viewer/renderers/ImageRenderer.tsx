import { useMemo } from 'react'
import { ImageLayer } from '../layer'
import type { ImageLayerDatum } from '../layer'
import { useSceneStore, useSceneStoreApi } from '../context'
import { useCoordinateTransform } from '../hooks/useCoordinateTransform'
import type { ImagePayload, LayerRendererProps, StyleConfig } from '../types'

function toImageDatum(payload: ImagePayload): ImageLayerDatum | null {
  if (!payload.bounds) return null
  const { min_x, min_y, max_x, max_y } = payload.bounds
  const width = max_x - min_x
  const height = max_y - min_y
  const cx = (min_x + max_x) / 2
  const cy = (min_y + max_y) / 2
  return { url: payload.url, center: [cx, cy, 0], width, height }
}

export function ImageRenderer({ streamName, style }: LayerRendererProps) {
  const store = useSceneStoreApi()
  const meta = useSceneStore((s) => s.streamsMeta[streamName])
  const payload = useSceneStore((s) => s.streamState[streamName]) as ImagePayload | undefined
  const visible = useSceneStore((s) => s.visibleStreams[streamName] ?? true)
  const frameIndex = useSceneStore((s) => style.styleFn != null ? s.frameIndex : 0)
  const matrix = useCoordinateTransform(meta?.coordinate ?? 'world')

  const effectiveStyle = useMemo<StyleConfig>(() => {
    if (!style.styleFn) return style
    const metrics = store.getState().statistics?.metrics ?? null
    return { ...style, ...style.styleFn({ frameIndex, metrics }) }
  }, [style, frameIndex, store])

  const datum = useMemo<ImageLayerDatum | null>(
    () => (payload ? toImageDatum(payload) : null),
    [payload],
  )

  if (!visible || !datum) return null

  return (
    <group matrix={matrix} matrixAutoUpdate={false}>
      <ImageLayer
        data={datum}
        opacity={effectiveStyle.opacity}
        visible={visible}
        renderOrder={effectiveStyle.renderOrder}
      />
    </group>
  )
}
