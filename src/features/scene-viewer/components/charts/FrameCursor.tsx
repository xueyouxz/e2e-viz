import { useEffect, useRef } from 'react'
import { useSceneStoreApi } from '../../context'
import { ML, PLOT_W } from './chartUtils'

const PILL_H     = 11
const PILL_PAD_X = 4
const CHAR_W     = 4.5

interface FrameCursorProps {
  frameCount: number
  y1: number
  y2: number
  stroke: string
  /** When false, hides the vertical dashed line. Defaults to true. */
  showLine?: boolean
  /** When provided alongside circleY, shows a value label. */
  data?: Float32Array | null
  valueFormat?: (v: number) => string
  /** When provided, renders a circle at (x, circleY(fi)) with pill label above it. */
  circleY?: (fi: number) => number
  /** When provided, overrides circle + label color based on the current data value. */
  colorFromValue?: (v: number) => string
  /** Background fill for the pill label. */
  pillBg?: string
}

export function FrameCursor({
  frameCount, y1, y2, stroke,
  showLine = true,
  data, valueFormat, circleY,
  colorFromValue,
  pillBg = 'rgb(0 0 0 / 60%)',
}: FrameCursorProps) {
  const store     = useSceneStoreApi()
  const lineRef   = useRef<SVGLineElement>(null)
  const circleRef = useRef<SVGCircleElement>(null)
  const pillRef   = useRef<SVGRectElement>(null)
  const textRef   = useRef<SVGTextElement>(null)

  useEffect(() => {
    const toX = (fi: number) =>
      frameCount > 1 ? ML + (fi / (frameCount - 1)) * PLOT_W : ML

    const apply = (fi: number) => {
      const x  = toX(fi)
      const xs = String(x)

      if (showLine) {
        const el = lineRef.current
        if (el) { el.setAttribute('x1', xs); el.setAttribute('x2', xs) }
      }

      if (!circleY) return

      const cy    = circleY(fi)
      const cys   = String(cy)
      const v     = data ? (data[fi] ?? 0) : null
      const color = (colorFromValue && v !== null) ? colorFromValue(v) : stroke

      const circleEl = circleRef.current
      if (circleEl) {
        circleEl.setAttribute('cx', xs)
        circleEl.setAttribute('cy', cys)
        circleEl.setAttribute('fill', color)
      }

      if (data === undefined || data === null) return

      const label  = v !== null ? (valueFormat ? valueFormat(v) : v.toFixed(2)) : ''
      const pillW  = label.length * CHAR_W + PILL_PAD_X * 2
      const pillX  = x - pillW / 2
      const pillY  = cy - 8 - PILL_H

      const pillEl = pillRef.current
      if (pillEl) {
        pillEl.setAttribute('x', String(pillX))
        pillEl.setAttribute('y', String(pillY))
        pillEl.setAttribute('width', String(pillW))
      }

      const textEl = textRef.current
      if (textEl) {
        textEl.setAttribute('x', xs)
        textEl.setAttribute('y', String(pillY + PILL_H / 2))
        textEl.setAttribute('fill', color)
        textEl.textContent = label
      }
    }

    apply(store.getState().frameIndex)

    let prev = store.getState().frameIndex
    return store.subscribe((s) => {
      if (s.frameIndex === prev) return
      prev = s.frameIndex
      apply(s.frameIndex)
    })
  }, [frameCount, store, data, valueFormat, circleY, showLine, stroke, colorFromValue])

  const initFi    = store.getState().frameIndex
  const initX     = frameCount > 1 ? ML + (initFi / (frameCount - 1)) * PLOT_W : ML
  const initV     = data ? (data[initFi] ?? 0) : null
  const initCY    = circleY ? circleY(initFi) : null
  const initColor = (colorFromValue && initV !== null) ? colorFromValue(initV) : stroke
  const initLabel = initV !== null ? (valueFormat ? valueFormat(initV) : initV.toFixed(2)) : ''
  const initPillW = initLabel.length * CHAR_W + PILL_PAD_X * 2
  const initPillX = initX - initPillW / 2
  const initPillY = initCY !== null ? initCY - 8 - PILL_H : 0

  return (
    <>
      {showLine && (
        <line
          ref={lineRef}
          x1={initX} x2={initX}
          y1={y1} y2={y2}
          strokeWidth="1"
          stroke={stroke}
          strokeDasharray="3 2"
        />
      )}
      {circleY != null && (
        <circle
          ref={circleRef}
          cx={initX}
          cy={initCY ?? 0}
          r={4}
          fill={initColor}
          stroke="none"
          style={{ pointerEvents: 'none' }}
        />
      )}
      {circleY != null && data != null && (
        <>
          <rect
            ref={pillRef}
            x={initPillX}
            y={initPillY}
            width={initPillW}
            height={PILL_H}
            rx={2.5}
            fill={pillBg}
            style={{ pointerEvents: 'none' }}
          />
          <text
            ref={textRef}
            x={initX}
            y={initPillY + PILL_H / 2}
            textAnchor="middle"
            fontSize="7.5"
            fontWeight="600"
            fill={initColor}
            dominantBaseline="middle"
            style={{ pointerEvents: 'none' }}
          >
            {initLabel}
          </text>
        </>
      )}
    </>
  )
}
