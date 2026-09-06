import { useMemo } from 'react'
import { area, color, curveMonotoneX, line, scaleLinear, stack } from 'd3'
import type { SeriesPoint } from 'd3'
import { useSceneStoreApi } from '../../context'
import { getObjectColor, svgTokens } from '../../styleConfig'
import type { ObjectCountSeries } from '../../types'
import { FrameCursor } from './FrameCursor'
import { usePlotHeight } from './usePlotHeight'
import { FrameValue } from './FrameValue'
import { ML, PLOT_W, SVG_W, arrayMax, makeXInvert, seekOnClick, seekOnKeyDown } from './chartUtils'

const CATEGORY_IDS: Record<string, number> = {
  car: 4,
  pedestrian: 7,
  truck: 10
}
const TOP = 5

interface ObjectCountChartProps {
  gtSeries: ObjectCountSeries | undefined
  frameCount: number
}

export function ObjectCountChart({ gtSeries, frameCount }: ObjectCountChartProps) {
  const { ref, height } = usePlotHeight(111)
  const bottom = height - 5
  const store = useSceneStoreApi()
  const palette = svgTokens.chart
  const { paths, total, maxLabel, xInvert } = useMemo(() => {
    const categories = Object.keys(CATEGORY_IDS).filter(category => gtSeries?.categories[category])
    const rows = Array.from({ length: frameCount }, (_, i) =>
      Object.fromEntries(
        categories.map(category => [category, gtSeries?.categories[category][i] ?? 0])
      )
    )
    const x = scaleLinear([0, Math.max(1, frameCount - 1)], [ML, ML + PLOT_W])
    // The readout and axis describe the categories in this chart, not unplotted GT classes.
    const total = gtSeries
      ? Float32Array.from(rows, row => categories.reduce((sum, category) => sum + row[category], 0))
      : null
    const y = scaleLinear([0, arrayMax(total)], [bottom, TOP]).nice()
    const paths = categories.length
      ? stack<Record<string, number>>()
          .keys(categories)(rows)
          .map(series => {
            const fill = getObjectColor(CATEGORY_IDS[series.key] ?? 0).color
            return {
              key: series.key,
              fill,
              stroke: color(fill)?.darker(0.6).formatHex() ?? fill,
              area:
                area<SeriesPoint<Record<string, number>>>()
                  .x((_, i) => x(i))
                  .y0(d => y(d[0]))
                  .y1(d => y(d[1]))
                  .curve(curveMonotoneX)(series) ?? '',
              line:
                line<SeriesPoint<Record<string, number>>>()
                  .x((_, i) => x(i))
                  .y(d => y(d[1]))
                  .curve(curveMonotoneX)(series) ?? ''
            }
          })
      : []
    return { paths, total, maxLabel: y.domain()[1], xInvert: makeXInvert(frameCount) }
  }, [gtSeries, frameCount, bottom])

  return (
    <div className='scene-statistics-chart scene-statistics-chart--objects'>
      <div className='scene-statistics-heading'>
        <h3>Object</h3>
        <FrameValue data={total} />
      </div>
      {!gtSeries ? (
        <p className='scene-statistics-empty'>No GT data</p>
      ) : (
        <>
          <div className='scene-statistics-legend'>
            {paths.map(({ key, fill }) => (
              <span key={key}>
                <i style={{ background: fill }} />
                {key}
              </span>
            ))}
          </div>
          <svg
            ref={ref}
            className='scene-statistics-plot'
            viewBox={`0 0 ${SVG_W} ${height}`}
            role='img'
            aria-label='GT counts for car, pedestrian and truck. Click or use arrow keys to seek.'
            tabIndex={0}
            onClick={e => seekOnClick(e, xInvert, frameCount, store)}
            onKeyDown={e => seekOnKeyDown(e, frameCount, store)}
          >
            {paths.map(path => (
              <g key={path.key}>
                <path d={path.area} fill={path.fill} fillOpacity='0.45' />
                <path d={path.line} fill='none' stroke={path.stroke} strokeWidth='1' />
              </g>
            ))}
            <text
              x={ML + 4}
              y={TOP + 12}
              fontSize='10'
              fill={palette.tickFill}
              stroke={palette.surface}
              strokeWidth='2'
              paintOrder='stroke'
              pointerEvents='none'
            >
              {maxLabel}
            </text>
            <FrameCursor frameCount={frameCount} y1={TOP} y2={bottom} />
          </svg>
        </>
      )}
    </div>
  )
}
