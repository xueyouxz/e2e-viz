import { useCallback, useState } from 'react'
import { SVG_W } from './chartUtils'

// Match the viewBox to the flex-allocated space without stretching text or cursor dots.
export function usePlotHeight(initialHeight: number) {
  const [height, setHeight] = useState(initialHeight)

  const ref = useCallback((svg: SVGSVGElement | null) => {
    if (!svg) return
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect
      if (width > 0 && height > 0) setHeight((height / width) * SVG_W)
    })
    observer.observe(svg)
    return () => observer.disconnect()
  }, [])

  return { ref, height }
}
