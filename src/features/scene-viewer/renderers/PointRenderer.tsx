import { useMemo } from 'react'
import { PointLayer } from '../layer'
import { useSceneStore, useSceneStoreApi } from '../context'
import { useCoordinateTransform } from '../hooks/useCoordinateTransform'
import type { PointPayload, LayerRendererProps, StyleConfig } from '../types'

export function PointRenderer({ streamName, style }: LayerRendererProps) {
  const store = useSceneStoreApi()
  const meta = useSceneStore((s) => s.streamsMeta[streamName])
  const payload = useSceneStore((s) => s.streamState[streamName]) as PointPayload | undefined
  const visible = useSceneStore((s) => s.visibleStreams[streamName] ?? true)
  const frameIndex = useSceneStore((s) => style.styleFn != null ? s.frameIndex : 0)
  const matrix = useCoordinateTransform(meta?.coordinate ?? 'world')

  const effectiveStyle = useMemo<StyleConfig>(() => {
    if (!style.styleFn) return style
    const metrics = store.getState().statistics?.metrics ?? null
    return { ...style, ...style.styleFn({ frameIndex, metrics }) }
  }, [style, frameIndex, store])

  if (!visible || !payload) return null

  return (
    <group matrix={matrix} matrixAutoUpdate={false}>
      <PointLayer
        points={payload.points}
        color={effectiveStyle.color}
        opacity={effectiveStyle.opacity}
        visible={visible}
        renderOrder={effectiveStyle.renderOrder}
        intensities={payload.intensity ?? undefined}
      />
    </group>
  )
}
