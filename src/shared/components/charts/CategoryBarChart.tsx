import { useEffect, useLayoutEffect, useRef } from 'react'
import * as d3 from 'd3'
import styles from './CategoryBarChart.module.css'

export type BarDatum = {
  id: string
  label: string
  total: number
  selected: number
  color: string
}

type Props = {
  bars: BarDatum[]
  activeIds: string[]
  onBarClick: (id: string) => void
}

// ── Layout constants ──────────────────────────────────────────────────────────

const LABEL_W = 36
const BAR_W = 88
const COUNT_W = 52
const GAP = 6
const ROW_H = 22
const ROW_GAP = 7
const BAR_H = 18
const PT = 7
const PB = 7
const PL = 6
const PR = 6

const SVG_W = PL + LABEL_W + GAP + BAR_W + GAP + COUNT_W + PR
const BAR_X = PL + LABEL_W + GAP
const COUNT_X = BAR_X + BAR_W + GAP

const PILL_W = 44
const PILL_H = 15

// Derived vertical offsets — computed once so they're not repeated inside D3 callbacks.
const BAR_Y = (ROW_H - BAR_H) / 2
const PILL_Y = (ROW_H - PILL_H) / 2

function svgHeight(n: number): number {
  return PT + n * ROW_H + Math.max(0, n - 1) * ROW_GAP + PB
}

// ── Component ─────────────────────────────────────────────────────────────────

export function CategoryBarChart({ bars, activeIds, onBarClick }: Props) {
  const svgRef = useRef<SVGSVGElement>(null)
  const clickRef = useRef(onBarClick)

  // Keep the callback ref current so the D3 click handler never closes over a stale prop.
  useLayoutEffect(() => {
    clickRef.current = onBarClick
  })

  useEffect(() => {
    if (!svgRef.current) return
    const svg = d3.select(svgRef.current)

    const hasSelection = bars.some(b => b.selected > 0)
    const maxTotal = d3.max(bars, b => b.total) ?? 1
    const xScale = d3.scaleLinear([0, maxTotal], [0, BAR_W])
    // When exactly one split is active, clicking it must be a no-op — communicate
    // this with a not-allowed cursor rather than silently ignoring the click.
    const soloActiveId = activeIds.length === 1 ? activeIds[0] : null

    // ── Enter: build the static SVG skeleton for each row ────────────────────

    const sel = svg.selectAll<SVGGElement, BarDatum>('g.row').data(bars, d => d.id)
    sel.exit().remove()

    const entered = sel
      .enter()
      .append('g')
      .attr('class', 'row')
      .on('click', (_, d) => clickRef.current(d.id))

    // Background track — y and height are fixed; width is set in update.
    entered
      .append('rect')
      .attr('class', `bg ${styles.bgBar}`)
      .attr('x', BAR_X)
      .attr('y', BAR_Y)
      .attr('height', BAR_H)

    // Foreground bar — starts at zero width, animated in update.
    entered
      .append('rect')
      .attr('class', 'fg')
      .attr('x', BAR_X)
      .attr('y', BAR_Y)
      .attr('height', BAR_H)
      .attr('width', 0)

    // Row label — x and alignment are fixed.
    entered
      .append('text')
      .attr('class', `lbl ${styles.label}`)
      .attr('x', PL)
      .attr('y', ROW_H / 2)
      .attr('text-anchor', 'start')
      .attr('dominant-baseline', 'middle')

    // Count pill background — x, y, size are fixed; fill is set in update.
    entered
      .append('rect')
      .attr('class', `pill ${styles.countPill}`)
      .attr('x', COUNT_X)
      .attr('y', PILL_Y)
      .attr('width', PILL_W)
      .attr('height', PILL_H)

    // Count text — position fixed; tspan children rebuilt in update.
    entered
      .append('text')
      .attr('class', 'cnt')
      .attr('x', COUNT_X + PILL_W / 2)
      .attr('y', ROW_H / 2)
      .attr('text-anchor', 'middle')
      .attr('dominant-baseline', 'middle')

    // ── Update: apply data-driven and state-driven changes ────────────────────

    const rows = entered.merge(sel)

    rows
      .attr('transform', (_, i) => `translate(0,${PT + i * (ROW_H + ROW_GAP)})`)
      .style('cursor', d => (d.id === soloActiveId ? 'not-allowed' : 'pointer'))

    rows
      .transition('opacity')
      .duration(180)
      .attr('opacity', d => (activeIds.includes(d.id) ? 1 : 0.32))

    // Background track width always reflects the full total.
    rows.select('.bg').attr('width', d => xScale(d.total))

    // Foreground bar: color greys out when inactive; width animates to reflect
    // either the lasso-selected count or the total.
    rows
      .select<SVGRectElement>('.fg')
      .attr('fill', d => (activeIds.includes(d.id) ? d.color : '#94a3b8'))
      .transition('bar-width')
      .duration(340)
      .ease(d3.easeQuadOut)
      .attr('width', d => xScale(hasSelection ? d.selected : d.total))

    rows.select('.lbl').text(d => d.label)

    // Pill tint stays tied to the split color regardless of active/inactive state
    // (the row opacity handles the visual dimming).
    rows.select('.pill').attr('fill', d => `${d.color}18`)

    // Count text: show "selected/total" only when this specific bar has a selection;
    // fall back to just "total" otherwise.
    rows.select('.cnt').each(function (d) {
      const node = d3.select(this)
      node.selectAll('tspan').remove()
      if (hasSelection && d.selected > 0) {
        node
          .append('tspan')
          .attr('class', styles.countMain)
          .attr('fill', d.color)
          .text(String(d.selected))
        node.append('tspan').attr('class', styles.countSep).text(`/${d.total}`)
      } else {
        node
          .append('tspan')
          .attr('class', styles.countMain)
          .attr('fill', d.color)
          .text(String(d.total))
      }
    })
  }, [bars, activeIds])

  return <svg ref={svgRef} className={styles.svg} width={SVG_W} height={svgHeight(bars.length)} />
}
