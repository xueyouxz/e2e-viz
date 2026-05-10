import { memo, useLayoutEffect, useRef, useState } from 'react'
import { drawPseudo3DWireframes } from '../lib/camera/wireframe'
import type { OverlayFitMode, ProjectedBox3DWireframe } from '../lib/camera/types'

interface CameraOverlayCanvasProps {
  boxes: ProjectedBox3DWireframe[]
  sourceWidth: number
  sourceHeight: number
  fitMode: OverlayFitMode
  className?: string
  selectedTrackId?: number | null
}

interface ViewportTransform {
  scale: number
  offsetX: number
  offsetY: number
}

function getViewportTransform(
  containerWidth: number,
  containerHeight: number,
  sourceWidth: number,
  sourceHeight: number,
  fitMode: OverlayFitMode,
): ViewportTransform {
  if (containerWidth <= 0 || containerHeight <= 0 || sourceWidth <= 0 || sourceHeight <= 0) {
    return { scale: 1, offsetX: 0, offsetY: 0 }
  }

  const scale = fitMode === 'cover'
    ? Math.max(containerWidth / sourceWidth, containerHeight / sourceHeight)
    : Math.min(containerWidth / sourceWidth, containerHeight / sourceHeight)

  return {
    scale,
    offsetX: (containerWidth - sourceWidth * scale) / 2,
    offsetY: (containerHeight - sourceHeight * scale) / 2,
  }
}

function CameraOverlayCanvasComponent({
  boxes,
  sourceWidth,
  sourceHeight,
  fitMode,
  className,
  selectedTrackId,
}: CameraOverlayCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const [size, setSize] = useState({ width: 0, height: 0 })

  useLayoutEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !canvas.parentElement) return

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0]
      if (!entry) return
      const nextWidth = Math.round(entry.contentRect.width)
      const nextHeight = Math.round(entry.contentRect.height)
      setSize((prev) =>
        prev.width === nextWidth && prev.height === nextHeight
          ? prev
          : { width: nextWidth, height: nextHeight },
      )
    })

    observer.observe(canvas.parentElement)
    return () => observer.disconnect()
  }, [])

  useLayoutEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || size.width <= 0 || size.height <= 0) return

    const dpr = window.devicePixelRatio || 1
    canvas.width = Math.max(1, Math.floor(size.width * dpr))
    canvas.height = Math.max(1, Math.floor(size.height * dpr))

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, size.width, size.height)

    const { scale, offsetX, offsetY } = getViewportTransform(
      size.width, size.height, sourceWidth, sourceHeight, fitMode,
    )

    ctx.save()
    ctx.translate(offsetX, offsetY)
    ctx.scale(scale, scale)

    drawPseudo3DWireframes(ctx, boxes, {
      clipMinU: -offsetX / scale,
      clipMaxU: (size.width - offsetX) / scale,
      clipMinV: -offsetY / scale,
      clipMaxV: (size.height - offsetY) / scale,
      cullMargin: 24 / scale,
      displayScale: scale,
      selectedTrackId,
    })

    ctx.restore()
  }, [boxes, fitMode, size.height, size.width, sourceHeight, sourceWidth, selectedTrackId])

  return <canvas ref={canvasRef} className={className} />
}

export const CameraOverlayCanvas = memo(CameraOverlayCanvasComponent)
