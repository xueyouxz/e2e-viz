import { useCallback, useLayoutEffect, useMemo, useRef } from 'react'
import { select, scaleLinear, area, curveMonotoneX, interpolateRgb } from 'd3'
import { useSceneStoreApi } from '../../context'
import { useThemeTokens } from '../../themeTokens'
import { FrameCursor } from './FrameCursor'
import { ML, PLOT_W, SVG_W, makeXInvert, seekOnClick } from './chartUtils'
import styles from '../StatisticsPanel.module.css'

const HC_H = 42
const NBANDS = 5
const BAND_OPACITY = 0.5
const MARKER_ROW_H = 11

// Linear color scale: white (low/good) → deep red (high/bad).
const _whiteToRed = interpolateRgb('#ffffff', '#b91c1c')

function bandColor(k: number, n: number): string {
  const t = n <= 1 ? 0 : k / (n - 1)
  return _whiteToRed(t)
}

const BAND_COLORS: readonly string[] = Array.from(
  { length: NBANDS },
  (_, k) => bandColor(k, NBANDS),
)

interface HorizonChartProps {
  data: Float32Array | null
  label: string
  domain?: [number, number]
  frameCount: number
  markers?: Float32Array | null
}

export function HorizonChart({
  data,
  label,
  domain = [0, 1],
  frameCount,
  markers,
}: HorizonChartProps) {
  const store  = useSceneStoreApi()
  const { chart: palette } = useThemeTokens()

  // D3 manages all SVG content inside this <g>.
  const chartRef = useRef<SVGGElement>(null)

  const hasMarkers = !!markers
  const svgH = hasMarkers ? HC_H + MARKER_ROW_H : HC_H

  const xInvert = useMemo(() => makeXInvert(frameCount), [frameCount])

  useLayoutEffect(() => {
    const gEl = chartRef.current
    if (!gEl) return

    const root = select(gEl)
    root.selectAll('*').remove()

    // ── Path computation ───────────────────────────────────────────────────────
    const [dMin, dMax] = domain
    const N = data?.length ?? 0
    let fullPath = ''
    const collisionXs: number[] = []

    if (data && N > 0) {
      const xScale = scaleLinear([0, N - 1], [ML, ML + PLOT_W])

      // yScale: dMin → NBANDS*HC_H (stack bottom), dMax → 0 (stack top).
      // The area spans [0, NBANDS*HC_H]; each band occupies one HC_H slice.
      const yScale = scaleLinear([dMin, dMax], [NBANDS * HC_H, 0])

      const areaGen = area<number>()
        .x((_, i) => xScale(i))
        .y0(NBANDS * HC_H)
        .y1((v) => Math.min(NBANDS * HC_H, Math.max(0, yScale(v))))
        .curve(curveMonotoneX)

      fullPath = areaGen(Array.from(data)) ?? ''

      if (markers) {
        for (let i = 0; i < markers.length; i++) {
          if (markers[i] > 0) collisionXs.push(xScale(i))
        }
      }
    }

    // ── Shared clip path ───────────────────────────────────────────────────────
    // All bands share one clip window at y=[0, HC_H].
    // Each band uses a different translate() to move ITS slice into this window.
    // Higher bands are rendered on top, naturally covering lower bands.
    //
    // FIX: Previous per-band clip paths were placed at y=(NBANDS-k-1)*HC_H but
    // the translated content landed at y=[0,HC_H] → mismatch → only the last
    // band (k=NBANDS-1) was ever visible.
    const clipId = `hc-clip-${label}`
    const defs = root.append('defs')
    defs.append('clipPath')
      .attr('id', clipId)
      .attr('clipPathUnits', 'userSpaceOnUse')
      .append('rect')
        .attr('x', ML)
        .attr('y', 0)
        .attr('width', PLOT_W)
        .attr('height', HC_H)

    // ── Chart background ───────────────────────────────────────────────────────
    root.append('rect')
      .attr('x', ML).attr('y', 0)
      .attr('width', PLOT_W).attr('height', HC_H)
      .attr('fill', palette.chartBg)

    // ── Horizon bands ──────────────────────────────────────────────────────────
    // Band k covers the value slice at y=[(NBANDS-k-1)*HC_H, (NBANDS-k)*HC_H]
    // in the full stacked coordinate space.
    // translate(0, -(NBANDS-k-1)*HC_H) brings that slice to y=[0, HC_H],
    // where the shared clip passes it through.
    if (fullPath) {
      BAND_COLORS.forEach((color, k) => {
        root.append('g')
          .attr('clip-path', `url(#${clipId})`)
          .append('g')
            .attr('transform', `translate(0, ${-(NBANDS - k - 1) * HC_H})`)
          .append('path')
            .attr('d', fullPath)
            .attr('fill', color)
            .attr('fill-opacity', String(BAND_OPACITY))
            .attr('stroke', 'none')
      })
    }

    // ── Label ──────────────────────────────────────────────────────────────────
    root.append('text')
      .attr('text-anchor', 'end')
      .attr('font-size', '8')
      .attr('dominant-baseline', 'middle')
      .attr('x', ML - 4)
      .attr('y', HC_H / 2)
      .attr('fill', palette.labelFill)
      .text(label)

    // ── Collision markers ──────────────────────────────────────────────────────
    if (hasMarkers) {
      collisionXs.forEach((cx) => {
        root.append('circle')
          .attr('cx', cx)
          .attr('cy', HC_H + MARKER_ROW_H / 2)
          .attr('r', 3)
          .attr('fill', '#EF4444')
          .attr('stroke', palette.collisionBg)
          .attr('stroke-width', '0.8')
      })
    }
  }, [data, domain, frameCount, hasMarkers, label, markers, palette])

  const handleClick = useCallback(
    (e: React.MouseEvent<SVGSVGElement>) => seekOnClick(e, xInvert, frameCount, store),
    [xInvert, frameCount, store],
  )

  return (
    <svg
      viewBox={`0 0 ${SVG_W} ${svgH}`}
      width="100%"
      className={styles.chart}
      onClick={handleClick}
    >
      {/* D3 manages all static chart content here */}
      <g ref={chartRef} />
      {/* FrameCursor stays as React component — it imperatively updates a <line> DOM ref */}
      <FrameCursor
        frameCount={frameCount}
        y1={0} y2={HC_H}
        stroke={palette.frameStroke}
      />
    </svg>
  )
}
