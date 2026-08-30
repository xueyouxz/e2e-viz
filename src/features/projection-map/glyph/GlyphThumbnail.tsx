import { useEffect, useRef } from 'react'
import { glyphAtlasLoader, glyphAtlasSourceRect } from './glyphAtlas'

interface GlyphThumbnailProps {
  sceneName: string
  className?: string
  size?: number
}

const BACKING_SCALE = 2

export function GlyphThumbnail({ sceneName, className, size = 92 }: GlyphThumbnailProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    let mounted = true
    const canvas = canvasRef.current
    const context = canvas?.getContext('2d')
    const source = glyphAtlasSourceRect(sceneName)
    if (!canvas || !context || !source) return

    context.clearRect(0, 0, canvas.width, canvas.height)
    void glyphAtlasLoader.load().then(
      atlas => {
        if (!mounted) return
        context.imageSmoothingEnabled = true
        context.imageSmoothingQuality = 'high'
        context.drawImage(
          atlas,
          source.sx,
          source.sy,
          source.size,
          source.size,
          0,
          0,
          canvas.width,
          canvas.height
        )
      },
      () => {
        // The canvas background remains as the non-blocking placeholder.
      }
    )

    return () => {
      mounted = false
    }
  }, [sceneName, size])

  return (
    <canvas
      ref={canvasRef}
      className={className}
      width={size * BACKING_SCALE}
      height={size * BACKING_SCALE}
      role='img'
      aria-label={`${sceneName} glyph`}
    />
  )
}
