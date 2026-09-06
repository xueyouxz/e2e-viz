import { useEffect, useRef } from 'react'
import { useSceneStoreApi } from '../../context'
import { svgTokens } from '../../styleConfig'
import { ML, PLOT_W } from './chartUtils'

interface FrameCursorProps {
  showLine?: boolean
  frameCount: number
  y1: number
  y2: number
  data?: Float32Array | null
  circleY?: (fi: number) => number
  circleColor?: (value: number) => string
}

export function FrameCursor({
  showLine = true,
  frameCount,
  y1,
  y2,
  data,
  circleY,
  circleColor
}: FrameCursorProps) {
  const store = useSceneStoreApi()
  const lineRef = useRef<SVGLineElement>(null)
  const circleRef = useRef<SVGCircleElement>(null)

  useEffect(() => {
    const apply = (fi: number) => {
      const x = String(frameCount > 1 ? ML + (fi / (frameCount - 1)) * PLOT_W : ML)
      lineRef.current?.setAttribute('x1', x)
      lineRef.current?.setAttribute('x2', x)
      const circle = circleRef.current
      if (!circle || !circleY) return
      const value = data?.[fi]
      circle.setAttribute(
        'visibility',
        value == null || !Number.isFinite(value) ? 'hidden' : 'visible'
      )
      if (value == null || !Number.isFinite(value)) return
      circle.setAttribute('cx', x)
      circle.setAttribute('cy', String(circleY(fi)))
      circle.setAttribute('fill', circleColor?.(value) ?? svgTokens.chart.frameStroke)
    }
    let previous = store.getState().displayedFrameIndex
    apply(previous)
    return store.subscribe(s => {
      if (s.displayedFrameIndex === previous) return
      previous = s.displayedFrameIndex
      apply(previous)
    })
  }, [store, frameCount, data, circleY, circleColor, showLine])

  return (
    <g pointerEvents='none' aria-hidden='true'>
      {showLine && (
        <line
          ref={lineRef}
          x1={ML}
          x2={ML}
          y1={y1}
          y2={y2}
          stroke={svgTokens.chart.frameStroke}
          strokeWidth='1'
          strokeDasharray='2 3'
          opacity='0.75'
        />
      )}
      {circleY && (
        <circle
          ref={circleRef}
          visibility='hidden'
          r='2.7'
          stroke={svgTokens.chart.surface}
          strokeWidth='1.2'
        />
      )}
    </g>
  )
}
