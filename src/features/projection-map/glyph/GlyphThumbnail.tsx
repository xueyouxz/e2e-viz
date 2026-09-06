import { useLayoutEffect, useRef } from 'react'
import { glyphAtlasSourceRect } from './glyphAtlas'
import { useGlyphAtlas } from './useGlyphAtlas'
import { resolveGlyphCanvasPixelRatio } from './glyphCanvasRenderer'

export function GlyphThumbnail({
  sceneName,
  className
}: {
  sceneName: string
  className?: string
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const { bitmap } = useGlyphAtlas()
  const backingSize = 92 * resolveGlyphCanvasPixelRatio(window.devicePixelRatio)

  useLayoutEffect(() => {
    const canvas = canvasRef.current
    const context = canvas?.getContext('2d')
    if (!canvas || !context) return
    context.clearRect(0, 0, canvas.width, canvas.height)
    const source = glyphAtlasSourceRect(sceneName)
    if (!bitmap || !source) return
    context.imageSmoothingEnabled = true
    context.imageSmoothingQuality = 'high'
    context.drawImage(
      bitmap,
      source.sx,
      source.sy,
      source.size,
      source.size,
      0,
      0,
      canvas.width,
      canvas.height
    )
  }, [sceneName, bitmap, backingSize])

  return (
    <canvas
      ref={canvasRef}
      className={className}
      width={backingSize}
      height={backingSize}
      role='img'
      aria-label={`${sceneName} glyph`}
    />
  )
}
