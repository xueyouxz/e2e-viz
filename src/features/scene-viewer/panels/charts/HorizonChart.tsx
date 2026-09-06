import { useMemo } from 'react'
import { area, curveMonotoneX, scaleLinear } from 'd3'
import { useSceneStoreApi } from '../../context'
import { svgTokens } from '../../styleConfig'
import { FrameCursor } from './FrameCursor'
import { usePlotHeight } from './usePlotHeight'
import { FrameValue } from './FrameValue'
import { ML, PLOT_W, SVG_W, makeXInvert, seekOnClick, seekOnKeyDown } from './chartUtils'

const TOP = 3

interface HorizonChartProps {
  data: Float32Array
  label: string
  domain: [number, number]
  frameCount: number
  markers?: Float32Array
}

export function HorizonChart({ data, label, domain, frameCount, markers }: HorizonChartProps) {
  const { ref, height } = usePlotHeight(markers ? 81 : 48)
  const bottom = height - (markers ? 38 : 5)
  const collisionLabelY = bottom + 16
  const collisionY = bottom + 28
  const store = useSceneStoreApi()
  const palette = svgTokens.chart
  const { paths, collisionXs, xInvert } = useMemo(() => {
    const x = scaleLinear([0, Math.max(1, frameCount - 1)], [ML, ML + PLOT_W])
    const bandCount = palette.horizonBands.length
    const bandSize = (domain[1] - domain[0]) / bandCount || 1
    const values = Array.from(data)
    return {
      paths: palette.horizonBands.map((color, band) => ({
        color,
        path:
          area<number>()
            .defined(Number.isFinite)
            .x((_, i) => x(i))
            .y0(bottom)
            .y1(
              value =>
                bottom -
                Math.max(0, Math.min(1, (value - domain[0]) / bandSize - band)) * (bottom - TOP)
            )
            .curve(curveMonotoneX)(values) ?? ''
      })),
      collisionXs: markers
        ? Array.from(markers).flatMap((value, i) => (value > 0 ? [x(i)] : []))
        : [],
      xInvert: makeXInvert(frameCount)
    }
  }, [data, domain, frameCount, markers, palette, bottom])

  return (
    <div className={`scene-statistics-chart ${markers ? 'scene-statistics-chart--collision' : ''}`}>
      <div className='scene-statistics-label'>
        <span>{label}</span>
        <FrameValue data={data} />
      </div>
      <svg
        ref={ref}
        className='scene-statistics-plot'
        viewBox={`0 0 ${SVG_W} ${height}`}
        role='img'
        aria-label={`${label} history. Click or use arrow keys to seek.`}
        tabIndex={0}
        onClick={e => seekOnClick(e, xInvert, frameCount, store)}
        onKeyDown={e => seekOnKeyDown(e, frameCount, store)}
      >
        <rect x={ML} y={TOP} width={PLOT_W} height={bottom - TOP} fill={palette.chartBg} />
        {paths.map(({ color, path }) => (
          <path key={color} d={path} fill={color} />
        ))}
        {markers && (
          <>
            <text x='0' y={collisionLabelY} fontSize='10' fill={palette.tickFill}>
              Collision
            </text>
            <line
              x1={ML}
              x2={ML + PLOT_W}
              y1={collisionY}
              y2={collisionY}
              stroke={palette.baseStroke}
            />
            {collisionXs.map((x, i) => (
              <path
                key={i}
                d={`M${x},${collisionY - 4} l3,4 -3,4 -3,-4 Z`}
                fill={palette.accelerationNegative}
              />
            ))}
          </>
        )}
        <FrameCursor frameCount={frameCount} y1={TOP} y2={bottom} />
        {markers && <FrameCursor frameCount={frameCount} y1={collisionY - 6} y2={collisionY + 7} />}
      </svg>
    </div>
  )
}
