import { useMemo, useCallback, useState } from 'react'
import { scaleLinear, area, stack, curveMonotoneX } from 'd3'
import { useSceneStoreApi } from '../../context'
import { svgTokens } from '../../styleConfig'
import type { ObjectCountSeries } from '../../types'
import { FrameCursor } from './FrameCursor'
import { ML, PLOT_W, SVG_W, arrayMax, makeXInvert, seekOnClick } from './chartUtils'

const STREAM_H = 80
const STREAM_TOP = 14
const STREAM_BOT = STREAM_H - 4

const toggleBtn =
  'cursor-pointer rounded-[3px] border border-transparent bg-transparent px-2 py-0.5 text-[10px] font-semibold tracking-[0.05em] text-app-text-dim transition-colors hover:text-app-text-label'
const toggleBtnActive = 'border-app-border-btn bg-app-card-bg text-app-text-strong'
const legend = 'mb-[5px] flex flex-wrap gap-x-2.5 gap-y-1.5'
const legendItem = 'flex items-center gap-1 text-[10px] text-app-text-label'
const legendDot = 'inline-block h-2 w-2 shrink-0 rounded-sm'

const CATEGORY_COLORS: Record<string, string> = {
  car: '#4B8CF8',
  pedestrian: '#16A34A',
  truck: '#0284C7',
  bicycle: '#D97706',
  bus: '#7C3AED',
  motorcycle: '#0D9488',
  trailer: '#4F46E5'
}

const GT_CATEGORIES = ['car', 'pedestrian', 'truck']
const PRED_CATEGORIES = ['car', 'pedestrian']
const ALL_CATEGORIES = Array.from(new Set([...GT_CATEGORIES, ...PRED_CATEGORIES]))

type ActiveView = 'gt' | 'pred'
type FrameRow = Record<string, number>

function buildDenseRows(
  cats: string[],
  series: ObjectCountSeries | undefined,
  frameCount: number
): FrameRow[] {
  return Array.from({ length: frameCount }, (_, i) => {
    const row: FrameRow = {}
    for (const cat of cats) {
      row[cat] = series?.categories[cat]?.[i] ?? 0
    }
    return row
  })
}

interface ObjectCountChartProps {
  gtSeries: ObjectCountSeries | undefined
  predSeries: ObjectCountSeries | undefined
  frameCount: number
}

function ObjectCountLegend({
  gtSeries,
  predSeries
}: Pick<ObjectCountChartProps, 'gtSeries' | 'predSeries'>) {
  const visibleCategories = ALL_CATEGORIES.filter(
    category => gtSeries?.categories[category] || predSeries?.categories[category]
  )

  return (
    <div className={legend}>
      {visibleCategories.map(category => (
        <span key={category} className={legendItem}>
          <span
            className={legendDot}
            style={{ background: CATEGORY_COLORS[category] ?? '#888', opacity: 0.75 }}
          />
          {category}
        </span>
      ))}
    </div>
  )
}

export function ObjectCountChart({ gtSeries, predSeries, frameCount }: ObjectCountChartProps) {
  const store = useSceneStoreApi()
  const { chart: palette } = svgTokens
  const [active, setActive] = useState<ActiveView>('gt')

  const { paths, xInvert, maxLabel } = useMemo(() => {
    const xScale = scaleLinear([0, frameCount - 1], [ML, ML + PLOT_W])
    const xInvertFn = makeXInvert(frameCount)

    const isGt = active === 'gt'
    const cats = isGt
      ? GT_CATEGORIES.filter(c => gtSeries?.categories[c])
      : PRED_CATEGORIES.filter(c => predSeries?.categories[c])
    const series = isGt ? gtSeries : predSeries

    const data = buildDenseRows(cats, series, frameCount)
    const maxVal = arrayMax(series?.total ?? null)
    const yScale = scaleLinear([0, maxVal], [STREAM_BOT, STREAM_TOP])
    const stackGen = stack<FrameRow>()

    const builtPaths =
      cats.length === 0
        ? []
        : stackGen
            .keys(cats)(data)
            .map(s => {
              const areaGen = area<[number, number]>()
                .x((_, i) => xScale(i))
                .y0(d => yScale(d[0]))
                .y1(d => yScale(d[1]))
                .curve(curveMonotoneX)
              const pts = s.map(pt => [pt[0], pt[1]] as [number, number])
              return { key: s.key, path: areaGen(pts) ?? '' }
            })

    return {
      paths: builtPaths,
      xInvert: xInvertFn,
      maxLabel: String(Math.round(maxVal))
    }
  }, [gtSeries, predSeries, frameCount, active])

  const handleClick = useCallback(
    (e: React.MouseEvent<SVGSVGElement>) => seekOnClick(e, xInvert, frameCount, store),
    [xInvert, frameCount, store]
  )

  const tick = {
    textAnchor: 'end' as const,
    fontSize: '8',
    dominantBaseline: 'middle' as const,
    fill: palette.tickFill
  }

  return (
    <div>
      <ObjectCountLegend gtSeries={gtSeries} predSeries={predSeries} />
      <div className='mb-1.5 flex gap-0.5'>
        <button
          className={`${toggleBtn} ${active === 'gt' ? toggleBtnActive : ''}`}
          onClick={() => setActive('gt')}
          type='button'
        >
          GT
        </button>
        <button
          className={`${toggleBtn} ${active === 'pred' ? toggleBtnActive : ''}`}
          onClick={() => setActive('pred')}
          type='button'
        >
          Pred
        </button>
      </div>

      <svg
        viewBox={`0 0 ${SVG_W} ${STREAM_H}`}
        width='100%'
        className='mb-2.5 block w-full cursor-crosshair overflow-visible'
        onClick={handleClick}
      >
        <text {...tick} x={ML - 4} y={STREAM_TOP}>
          {maxLabel}
        </text>
        <text {...tick} x={ML - 4} y={STREAM_BOT}>
          0
        </text>
        <line
          x1={ML}
          x2={ML + PLOT_W}
          y1={STREAM_BOT}
          y2={STREAM_BOT}
          strokeWidth='1'
          stroke={palette.baseStroke}
        />

        {paths.map(({ key, path }) => (
          <path
            key={key}
            d={path}
            fill={CATEGORY_COLORS[key] ?? '#888'}
            fillOpacity='0.72'
            stroke='none'
          />
        ))}

        <FrameCursor
          frameCount={frameCount}
          y1={STREAM_TOP}
          y2={STREAM_BOT}
          stroke={palette.frameStroke}
        />
      </svg>
    </div>
  )
}
