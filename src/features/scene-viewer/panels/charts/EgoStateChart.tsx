import { useId, useMemo } from 'react'
import { area, line, scaleLinear, curveMonotoneX, max } from 'd3'
import { useSceneStoreApi } from '../../context'
import { svgTokens } from '../../styleConfig'
import { FrameCursor } from './FrameCursor'
import { usePlotHeight } from './usePlotHeight'
import { FrameValue } from './FrameValue'
import { ML, PLOT_W, SVG_W, makeXInvert, seekOnClick, seekOnKeyDown } from './chartUtils'

const palette = svgTokens.chart
const speedColor = () => palette.speed
const accelerationColor = (v: number) =>
  v >= 0 ? palette.accelerationPositive : palette.accelerationNegative
const speedFormat = (v: number) => v.toFixed(1)
const accelerationFormat = (v: number) => `${v >= 0 ? '+' : ''}${v.toFixed(1)}`
const tickFormat = (v: number) => String(Number(v.toFixed(2)))

interface EgoStateChartProps {
  egoSpeed: Float32Array | null
  egoAcceleration: Float32Array | null
  frameCount: number
}

export function EgoStateChart({ egoSpeed, egoAcceleration, frameCount }: EgoStateChartProps) {
  return (
    <>
      <EgoSeriesChart data={egoSpeed} frameCount={frameCount} kind='speed' />
      <EgoSeriesChart data={egoAcceleration} frameCount={frameCount} kind='acceleration' />
    </>
  )
}

function EgoSeriesChart({
  data,
  frameCount,
  kind
}: {
  data: Float32Array | null
  frameCount: number
  kind: 'speed' | 'acceleration'
}) {
  const store = useSceneStoreApi()
  const id = useId()
  const signed = kind === 'acceleration'
  const top = 5
  const { ref, height } = usePlotHeight(signed ? 86 : 74)
  const bottom = height - 5
  const label = signed ? 'Acceleration' : 'Speed'
  const unit = signed ? 'm/s²' : 'm/s'
  const { areaPath, linePath, y, domain, xInvert, yAtFrame } = useMemo(() => {
    const values = Array.from(data ?? [])
    const limit = max(values, Math.abs) || (signed ? 0.1 : 1)
    const y = scaleLinear([signed ? -limit : 0, limit], [bottom, top]).nice()
    const x = scaleLinear([0, Math.max(1, frameCount - 1)], [ML, ML + PLOT_W])
    return {
      areaPath:
        area<number>()
          .defined(Number.isFinite)
          .x((_, i) => x(i))
          .y0(y(0))
          .y1(v => y(v))
          .curve(curveMonotoneX)(values) ?? '',
      linePath:
        line<number>()
          .defined(Number.isFinite)
          .x((_, i) => x(i))
          .y(v => y(v))
          .curve(curveMonotoneX)(values) ?? '',
      y,
      domain: y.domain(),
      xInvert: makeXInvert(frameCount),
      yAtFrame: (fi: number) => y(data?.[fi] ?? 0)
    }
  }, [data, frameCount, signed, bottom])
  const tick = {
    textAnchor: 'start' as const,
    fontSize: 10,
    fill: palette.tickFill,
    stroke: palette.surface,
    strokeWidth: 2,
    paintOrder: 'stroke',
    pointerEvents: 'none' as const
  }

  return (
    <div className={`scene-statistics-chart scene-statistics-chart--${kind}`}>
      <div className='scene-statistics-label'>
        <span>{label}</span>
        <FrameValue data={data} format={signed ? accelerationFormat : speedFormat} unit={unit} />
      </div>
      <svg
        ref={ref}
        className='scene-statistics-plot'
        viewBox={`0 0 ${SVG_W} ${height}`}
        role='img'
        aria-label={`${label} in ${unit}. Click or use arrow keys to seek.`}
        tabIndex={0}
        onClick={e => seekOnClick(e, xInvert, frameCount, store)}
        onKeyDown={e => seekOnKeyDown(e, frameCount, store)}
      >
        {signed ? (
          <>
            <defs>
              <clipPath id={`${id}-positive`}>
                <rect x={ML - 2} y={top - 2} width={PLOT_W + 4} height={y(0) - top + 2} />
              </clipPath>
              <clipPath id={`${id}-negative`}>
                <rect x={ML - 2} y={y(0)} width={PLOT_W + 4} height={bottom - y(0) + 2} />
              </clipPath>
            </defs>
            {(['positive', 'negative'] as const).map(sign => {
              const color =
                sign === 'positive' ? palette.accelerationPositive : palette.accelerationNegative
              return (
                <g key={sign} clipPath={`url(#${id}-${sign})`}>
                  <path d={areaPath} fill={color} fillOpacity='0.56' />
                  <path d={linePath} fill='none' stroke={color} strokeWidth='1.6' />
                </g>
              )
            })}
            <line
              x1={ML}
              x2={ML + PLOT_W}
              y1={y(0)}
              y2={y(0)}
              stroke={palette.zeroStroke}
              strokeWidth='1.2'
            />
            <text {...tick} x={ML + 4} y={y(0) - 4}>
              0
            </text>
          </>
        ) : (
          <>
            <path d={areaPath} fill={palette.speed} fillOpacity='0.3' />
            <path d={linePath} fill='none' stroke={palette.speed} strokeWidth='1.6' />
          </>
        )}
        <text {...tick} x={ML + 4} y={top + 12}>
          {tickFormat(domain[1])}
        </text>
        {signed && (
          <text {...tick} x={ML + 4} y={bottom - 4}>
            {tickFormat(domain[0])}
          </text>
        )}
        <FrameCursor
          showLine={false}
          frameCount={frameCount}
          y1={top}
          y2={bottom}
          data={data}
          circleY={yAtFrame}
          circleColor={signed ? accelerationColor : speedColor}
        />
      </svg>
    </div>
  )
}
