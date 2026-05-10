import { useMemo, useCallback } from 'react'
import { scaleLinear, area, line, curveMonotoneX } from 'd3'
import { useSceneStoreApi } from '../../context'
import { useThemeTokens } from '../../themeTokens'
import { FrameCursor } from './FrameCursor'
import { ML, PLOT_W, SVG_W, arrayMax, arrayMin, makeXInvert, seekOnClick } from './chartUtils'
import styles from '../StatisticsPanel.module.css'

function accelColor(v: number): string {
  return v >= 0 ? ACCEL_POS : ACCEL_NEG
}

const E_LABEL_H = 16
const E_PLOT_H  = 48
const E_BASE_H  = 6
const E_SEC_H   = E_LABEL_H + E_PLOT_H + E_BASE_H
const E_GAP     = 10
const EGO_H     = E_SEC_H * 2 + E_GAP

const SP_LABEL_Y = E_LABEL_H / 2
const SP_TOP     = E_LABEL_H
const SP_BOT     = E_LABEL_H + E_PLOT_H

const AC_OFF     = E_SEC_H + E_GAP
const AC_LABEL_Y = AC_OFF + E_LABEL_H / 2
const AC_TOP     = AC_OFF + E_LABEL_H
const AC_BOT     = AC_OFF + E_LABEL_H + E_PLOT_H
const AC_MID     = (AC_TOP + AC_BOT) / 2

// Understated, professional data-visualization colors — not neon.
const SPEED_COLOR = '#3a6fa3'
const ACCEL_POS   = '#5a8a6a'
const ACCEL_NEG   = '#a05050'

interface EgoStateChartProps {
  egoSpeed: Float32Array | null
  egoAcceleration: Float32Array | null
  frameCount: number
}

export function EgoStateChart({ egoSpeed, egoAcceleration, frameCount }: EgoStateChartProps) {
  const store = useSceneStoreApi()
  const { chart: palette } = useThemeTokens()

  const {
    speedAreaPath, speedLinePath,
    accelPosAreaPath, accelNegAreaPath, accelLinePath,
    xInvert, accelZeroY, speedMaxLabel, speedYAtFi, accelYAtFi,
  } = useMemo(() => {
    const xScale    = scaleLinear([0, frameCount - 1], [ML, ML + PLOT_W])
    const xInvertFn = makeXInvert(frameCount)

    const speedMax   = arrayMax(egoSpeed)
    const speedYScale = scaleLinear([0, speedMax], [SP_BOT, SP_TOP])

    const accelAbs   = Math.max(Math.abs(arrayMax(egoAcceleration)), Math.abs(arrayMin(egoAcceleration)), 0.1)
    const accelYScale = scaleLinear([-accelAbs, accelAbs], [AC_BOT, AC_TOP])
    const zeroY      = accelYScale(0)

    const speedData = egoSpeed ? Array.from(egoSpeed) : []
    const accelData = egoAcceleration ? Array.from(egoAcceleration) : []

    const speedAreaGen = area<number>()
      .x((_, i) => xScale(i))
      .y0(SP_BOT)
      .y1((v) => speedYScale(v))
      .curve(curveMonotoneX)

    const speedLineGen = line<number>()
      .x((_, i) => xScale(i))
      .y((v) => speedYScale(v))
      .curve(curveMonotoneX)

    // Separate positive/negative acceleration areas for clearer coloring.
    const accelPosArea = area<number>()
      .x((_, i) => xScale(i))
      .y0(() => zeroY)
      .y1((v) => v >= 0 ? accelYScale(v) : zeroY)
      .curve(curveMonotoneX)

    const accelNegArea = area<number>()
      .x((_, i) => xScale(i))
      .y0(() => zeroY)
      .y1((v) => v < 0 ? accelYScale(v) : zeroY)
      .curve(curveMonotoneX)

    const accelLineGen = line<number>()
      .x((_, i) => xScale(i))
      .y((v) => accelYScale(v))
      .curve(curveMonotoneX)

    const speedYAtFiFn = (fi: number) => speedYScale(egoSpeed?.[fi] ?? 0)
    const accelYAtFiFn = (fi: number) => accelYScale(egoAcceleration?.[fi] ?? 0)

    return {
      speedAreaPath:    speedData.length ? (speedAreaGen(speedData) ?? '') : '',
      speedLinePath:    speedData.length ? (speedLineGen(speedData) ?? '') : '',
      accelPosAreaPath: accelData.length ? (accelPosArea(accelData) ?? '') : '',
      accelNegAreaPath: accelData.length ? (accelNegArea(accelData) ?? '') : '',
      accelLinePath:    accelData.length ? (accelLineGen(accelData) ?? '') : '',
      xInvert:         xInvertFn,
      accelZeroY:      zeroY,
      speedMaxLabel:   `${(speedMax * 3.6).toFixed(0)}`,
      speedYAtFi:      speedYAtFiFn,
      accelYAtFi:      accelYAtFiFn,
    }
  }, [egoSpeed, egoAcceleration, frameCount])

  const handleClick = useCallback(
    (e: React.MouseEvent<SVGSVGElement>) => seekOnClick(e, xInvert, frameCount, store),
    [xInvert, frameCount, store],
  )

  const tick = { textAnchor: 'end' as const, fontSize: '8', dominantBaseline: 'middle' as const, fill: palette.tickFill }
  const unit = { textAnchor: 'end' as const, fontSize: '8', dominantBaseline: 'middle' as const }
  const base = { strokeWidth: '1', stroke: palette.baseStroke }
  const zero = { strokeWidth: '1', stroke: palette.zeroStroke, strokeDasharray: '3 3' }

  const speedKmhFormat = useMemo(
    () => (v: number) => `${(v * 3.6).toFixed(0)}`,
    [],
  )

  const accelMsFormat = useMemo(
    () => (v: number) => `${v >= 0 ? '+' : ''}${v.toFixed(1)}`,
    [],
  )

  return (
    <svg viewBox={`0 0 ${SVG_W} ${EGO_H}`} width="100%" className={styles.chart} onClick={handleClick}>
      {/* ── Speed ─────────────────────────────────────────────────────────────── */}
      <text {...tick} x={ML - 4} y={SP_TOP}>{speedMaxLabel}</text>
      <text {...tick} x={ML - 4} y={SP_BOT}>0</text>
      <text {...unit} x={ML + PLOT_W} y={SP_LABEL_Y} fill={SPEED_COLOR}>km/h</text>
      <line x1={ML} x2={ML + PLOT_W} y1={SP_BOT} y2={SP_BOT} {...base} />
      {speedAreaPath && (
        <path d={speedAreaPath} fill={SPEED_COLOR} fillOpacity="0.15" stroke="none" />
      )}
      {speedLinePath && (
        <path d={speedLinePath} fill="none" stroke={SPEED_COLOR} strokeWidth="1.2" />
      )}
      <FrameCursor
        frameCount={frameCount} y1={SP_TOP} y2={SP_BOT}
        stroke={SPEED_COLOR}
        showLine={false}
        data={egoSpeed}
        valueFormat={speedKmhFormat}
        circleY={speedYAtFi}
        pillBg={palette.collisionBg}
      />

      {/* ── Acceleration ──────────────────────────────────────────────────────── */}
      <text {...tick} x={ML - 4} y={AC_MID}>0</text>
      <text {...unit} x={ML + PLOT_W} y={AC_LABEL_Y} fill={palette.tickFill}>m/s²</text>
      <line x1={ML} x2={ML + PLOT_W} y1={accelZeroY} y2={accelZeroY} {...zero} />
      {accelPosAreaPath && (
        <path d={accelPosAreaPath} fill={ACCEL_POS} fillOpacity="0.22" stroke="none" />
      )}
      {accelNegAreaPath && (
        <path d={accelNegAreaPath} fill={ACCEL_NEG} fillOpacity="0.22" stroke="none" />
      )}
      {accelLinePath && (
        <path d={accelLinePath} fill="none" stroke={palette.baseStroke} strokeWidth="1" />
      )}
      <FrameCursor
        frameCount={frameCount} y1={AC_TOP} y2={AC_BOT}
        stroke={ACCEL_POS}
        showLine={false}
        data={egoAcceleration}
        valueFormat={accelMsFormat}
        circleY={accelYAtFi}
        colorFromValue={accelColor}
        pillBg={palette.collisionBg}
      />
    </svg>
  )
}
