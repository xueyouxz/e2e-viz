import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import * as d3 from 'd3'
import type { ProjectionMapPoint, SplitName } from '@/types/scene'

const cls = {
  root: 'flex h-full w-full overflow-hidden bg-app-surface font-mono text-[11px]',
  canvasWrapper: 'relative min-w-0 flex-1 overflow-hidden',
  panel:
    'flex w-[280px] shrink-0 flex-col overflow-y-auto border-r border-app-border bg-app-surface-raised py-3.5 [scrollbar-color:var(--color-app-scrollbar)_transparent] [scrollbar-width:thin]',
  panelTitle:
    'mt-0 mb-2.5 border-b border-app-border px-4 pb-2.5 text-[12px] font-semibold tracking-[0.04em] text-app-text-strong uppercase',
  section: 'border-b border-app-border px-4 py-2.5 last:border-b-0',
  sectionLabel: 'mb-1.5 text-[10px] font-semibold tracking-[0.08em] text-app-text-dim uppercase',
  row: 'flex justify-between gap-2 py-0.5',
  rowLabel: 'shrink-0 text-app-text-label',
  rowValue: 'text-right break-all text-app-text-primary',
  formula:
    'mt-1.5 rounded-[5px] border border-app-card-border bg-app-card-bg px-2 py-[5px] text-[10px] tracking-[0.01em] text-app-text-dim',
  sceneName: 'mb-[5px] text-[10px] leading-[1.4] font-semibold break-all text-app-text-strong',
  canvas: 'block h-full w-full touch-none',
  bg: 'fill-app-surface',
  zoomLayer: '[will-change:transform]',
  gridLine: 'pointer-events-none stroke-app-text-ghost [stroke-width:0.5]',
  cellFill: 'pointer-events-none opacity-10',
  cellCross: 'pointer-events-none stroke-app-text-faint [stroke-width:1]',
  dotRep: 'opacity-90 [r:var(--scatter-r,4)]',
  dotNonRep: 'opacity-25 [r:calc(var(--scatter-r,4)*0.7)]',
  hoverCell: 'pointer-events-none fill-none opacity-85 [stroke:#f5c842] [stroke-width:1.5]',
  hoverRing: 'pointer-events-none fill-none [stroke:#f5c842] [stroke-width:2]',
  tooltip:
    'pointer-events-none absolute z-20 min-w-[190px] rounded-[7px] border border-app-border-btn bg-app-panel-bg-solid px-2.5 py-2 font-mono text-[11px] leading-[1.6] text-app-text-primary shadow-[0_4px_14px_rgb(0_0_0/25%)]',
  tooltipName: 'mb-[5px] text-[11px] leading-[1.4] font-semibold break-all text-app-text-strong',
  tooltipRow: 'flex justify-between gap-2.5',
  tooltipKey: 'shrink-0 text-app-text-dim',
  repYes: 'text-[#4ade80]',
  repNo: 'text-app-text-dim'
}

// ─── Constants (identical to ProjectionMapView) ────────────────────────────

const VIEWBOX_WIDTH = 1280
const VIEWBOX_HEIGHT = 760
const CHART_PADDING = 18
const POINT_RADIUS = 4
const CELL_SIZE = 70

const SPLIT_COLORS: Record<SplitName, string> = { train: '#1f77b4', val: '#d62728' }

const SNAP_LEVELS: readonly number[] = Array.from({ length: 21 }, (_, i) =>
  Math.pow(2, (i - 4) / 4)
)

// ─── LOD helpers (identical to ProjectionMapView) ──────────────────────────

function snapGridK(k: number): number {
  return Math.pow(2, Math.round(Math.log2(k) * 4) / 4)
}

type ScalePair = {
  x: d3.ScaleLinear<number, number>
  y: d3.ScaleLinear<number, number>
}

type Viewport = { k: number; tx: number; ty: number }

function computeGridCells(
  points: ProjectionMapPoint[],
  sc: ScalePair,
  k: number
): Map<string, ProjectionMapPoint> {
  const best = new Map<string, { point: ProjectionMapPoint; dist2: number }>()
  for (const point of points) {
    const sx = sc.x(point.tsne_comp1) * k
    const sy = sc.y(point.tsne_comp2) * k
    const ci = Math.floor(sx / CELL_SIZE)
    const cj = Math.floor(sy / CELL_SIZE)
    const key = `${ci},${cj}`
    const d2 = (sx - (ci + 0.5) * CELL_SIZE) ** 2 + (sy - (cj + 0.5) * CELL_SIZE) ** 2
    const ex = best.get(key)
    if (!ex || d2 < ex.dist2) best.set(key, { point, dist2: d2 })
  }
  const result = new Map<string, ProjectionMapPoint>()
  for (const [key, { point }] of best) result.set(key, point)
  return result
}

function buildGridIndex(
  pts: ProjectionMapPoint[],
  sc: ScalePair
): Map<number, Map<string, ProjectionMapPoint>> {
  const index = new Map<number, Map<string, ProjectionMapPoint>>()
  for (const k of SNAP_LEVELS) index.set(k, computeGridCells(pts, sc, k))
  return index
}

// ─── Types ─────────────────────────────────────────────────────────────────

type HoveredInfo = {
  point: ProjectionMapPoint
  screenX: number
  screenY: number
  ci: number
  cj: number
  isRepresentative: boolean
}

// ─── Sub-components ────────────────────────────────────────────────────────

type ScatterDotsProps = {
  points: ProjectionMapPoint[]
  scales: ScalePair
  representativeNames: Set<string>
}

// Memoised so it does not re-render on every zoom frame — only when LOD level
// changes and representativeNames is a new Set reference.
const ScatterDots = memo(function ScatterDots({
  points,
  scales,
  representativeNames
}: ScatterDotsProps) {
  return (
    <>
      {points.map(p => (
        <circle
          key={p.scene_name}
          cx={scales.x(p.tsne_comp1)}
          cy={scales.y(p.tsne_comp2)}
          className={representativeNames.has(p.scene_name) ? cls.dotRep : cls.dotNonRep}
          style={{ fill: SPLIT_COLORS[p.split] }}
        />
      ))}
    </>
  )
})

type InfoRowProps = { label: string; value: string; accent?: string }

function InfoRow({ label, value, accent }: InfoRowProps) {
  return (
    <div className={cls.row}>
      <span className={cls.rowLabel}>{label}</span>
      <span className={cls.rowValue} style={accent ? { color: accent } : undefined}>
        {value}
      </span>
    </div>
  )
}

// ─── Main component ────────────────────────────────────────────────────────

type Props = { points: ProjectionMapPoint[] }

export function ProjectionMapDebug({ points }: Props) {
  const svgRef = useRef<SVGSVGElement | null>(null)
  const scatterGroupRef = useRef<SVGGElement | null>(null)
  const transformRef = useRef(d3.zoomIdentity)

  const [viewport, setViewport] = useState<Viewport>({ k: 1, tx: 0, ty: 0 })
  const [hovered, setHovered] = useState<HoveredInfo | null>(null)

  // ── Scales ──────────────────────────────────────────────────────────────
  const scales = useMemo<ScalePair>(() => {
    const xExt = d3.extent(points, p => p.tsne_comp1)
    const yExt = d3.extent(points, p => p.tsne_comp2)
    return {
      x: d3
        .scaleLinear()
        .domain([xExt[0] ?? -1, xExt[1] ?? 1])
        .nice()
        .range([CHART_PADDING, VIEWBOX_WIDTH - CHART_PADDING]),
      y: d3
        .scaleLinear()
        .domain([yExt[0] ?? -1, yExt[1] ?? 1])
        .nice()
        .range([VIEWBOX_HEIGHT - CHART_PADDING, CHART_PADDING])
    }
  }, [points])

  const scalesRef = useRef(scales)
  useEffect(() => {
    scalesRef.current = scales
  }, [scales])

  // ── LOD grid index ───────────────────────────────────────────────────────
  const gridIndex = useMemo(() => buildGridIndex(points, scales), [points, scales])

  const snappedK = snapGridK(viewport.k)
  const lodLevelN = Math.round(Math.log2(viewport.k) * 4)

  const gridCells = useMemo(
    () => gridIndex.get(snappedK) ?? new Map<string, ProjectionMapPoint>(),
    [gridIndex, snappedK]
  )

  const representativeNames = useMemo(
    () => new Set([...gridCells.values()].map(p => p.scene_name)),
    [gridCells]
  )

  // ── Grid geometry ────────────────────────────────────────────────────────
  //
  // The LOD grid is computed in "snappedK-scaled" space. A cell boundary at
  // position n × CELL_SIZE in that space maps to screen space as:
  //   screen = n × CELL_SIZE × (k / snappedK) + tx
  //
  // When k == snappedK the cells are exactly CELL_SIZE px wide on screen.
  // Between snap level transitions the cells breathe slightly (ratio ≈ ±1.09).

  const { vLines, hLines, cellRects } = useMemo(() => {
    const { k, tx, ty } = viewport
    const effectiveSize = CELL_SIZE * (k / snappedK) // cell screen size

    const vLines: number[] = []
    const hLines: number[] = []

    for (
      let n = Math.floor(-tx / effectiveSize) - 1;
      n <= Math.ceil((VIEWBOX_WIDTH - tx) / effectiveSize) + 1;
      n++
    ) {
      const x = n * effectiveSize + tx
      if (x >= -1 && x <= VIEWBOX_WIDTH + 1) vLines.push(x)
    }

    for (
      let n = Math.floor(-ty / effectiveSize) - 1;
      n <= Math.ceil((VIEWBOX_HEIGHT - ty) / effectiveSize) + 1;
      n++
    ) {
      const y = n * effectiveSize + ty
      if (y >= -1 && y <= VIEWBOX_HEIGHT + 1) hLines.push(y)
    }

    const rects: {
      x: number
      y: number
      size: number
      ci: number
      cj: number
      point: ProjectionMapPoint
    }[] = []

    for (const [key, point] of gridCells) {
      const [ciStr, cjStr] = key.split(',')
      const ci = parseInt(ciStr, 10)
      const cj = parseInt(cjStr, 10)
      const x = ci * effectiveSize + tx
      const y = cj * effectiveSize + ty
      if (
        x < VIEWBOX_WIDTH + effectiveSize &&
        x > -effectiveSize &&
        y < VIEWBOX_HEIGHT + effectiveSize &&
        y > -effectiveSize
      ) {
        rects.push({ x, y, size: effectiveSize, ci, cj, point })
      }
    }

    return { vLines, hLines, cellRects: rects, effectiveSize }
  }, [viewport, snappedK, gridCells])

  // ── D3 zoom ──────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!svgRef.current) return
    const svg = d3.select(svgRef.current)

    const zoom = d3
      .zoom<SVGSVGElement, unknown>()
      .scaleExtent([1, 16])
      .translateExtent([
        [-VIEWBOX_WIDTH, -VIEWBOX_HEIGHT],
        [VIEWBOX_WIDTH * 2, VIEWBOX_HEIGHT * 2]
      ])
      .filter(event => !event.button)
      .on('zoom', (event: d3.D3ZoomEvent<SVGSVGElement, unknown>) => {
        const t = event.transform
        transformRef.current = t
        // Move the scatter group imperatively — avoids React re-rendering circles.
        scatterGroupRef.current?.setAttribute('transform', `translate(${t.x} ${t.y}) scale(${t.k})`)
        svgRef.current?.style.setProperty('--scatter-r', String(POINT_RADIUS / t.k))
        // Update viewport state so the grid layer and info panel stay in sync.
        setViewport({ k: t.k, tx: t.x, ty: t.y })
      })

    svg.call(zoom)
    return () => {
      svg.on('.zoom', null)
    }
  }, [])

  // ── Hover: find nearest point ─────────────────────────────────────────────
  const handleMouseMove = useCallback(
    (e: React.MouseEvent<SVGSVGElement>) => {
      const sc = scalesRef.current
      if (!sc || !svgRef.current) return

      const t = transformRef.current
      const r = svgRef.current.getBoundingClientRect()
      const vx = ((e.clientX - r.left) / r.width) * VIEWBOX_WIDTH
      const vy = ((e.clientY - r.top) / r.height) * VIEWBOX_HEIGHT

      // Convert viewBox → data coordinates
      const dx = (vx - t.x) / t.k
      const dy = (vy - t.y) / t.k

      // 20 px screen radius threshold, converted to data units
      const threshold2 = (20 / t.k) ** 2
      let nearest: ProjectionMapPoint | null = null
      let nearestD2 = Infinity

      for (const p of points) {
        const px = sc.x(p.tsne_comp1)
        const py = sc.y(p.tsne_comp2)
        const d2 = (px - dx) ** 2 + (py - dy) ** 2
        if (d2 < threshold2 && d2 < nearestD2) {
          nearestD2 = d2
          nearest = p
        }
      }

      if (nearest) {
        const sk = snapGridK(t.k)
        const sx = sc.x(nearest.tsne_comp1) * t.k + t.x
        const sy = sc.y(nearest.tsne_comp2) * t.k + t.y
        const ci = Math.floor((sc.x(nearest.tsne_comp1) * sk) / CELL_SIZE)
        const cj = Math.floor((sc.y(nearest.tsne_comp2) * sk) / CELL_SIZE)
        setHovered({
          point: nearest,
          screenX: sx,
          screenY: sy,
          ci,
          cj,
          isRepresentative: representativeNames.has(nearest.scene_name)
        })
      } else {
        setHovered(null)
      }
    },
    [points, representativeNames]
  )

  const handleMouseLeave = useCallback(() => setHovered(null), [])

  // ── Stats ────────────────────────────────────────────────────────────────
  const { trainCount, valCount } = useMemo(() => {
    let train = 0
    for (const p of points) if (p.split === 'train') train++
    return { trainCount: train, valCount: points.length - train }
  }, [points])

  // ── Render ───────────────────────────────────────────────────────────────

  const effectiveSize = CELL_SIZE * (viewport.k / snappedK)

  // Tooltip offset: flip sides when too close to the right/bottom edge
  const tooltipLeft = hovered ? hovered.screenX / VIEWBOX_WIDTH > 0.75 : false
  const tooltipTop = hovered ? hovered.screenY / VIEWBOX_HEIGHT > 0.75 : false

  const tooltipTransform =
    tooltipLeft && tooltipTop
      ? 'translate-x-[calc(-100%-12px)] translate-y-[calc(-100%-12px)]'
      : tooltipLeft
        ? 'translate-x-[calc(-100%-12px)] translate-y-3'
        : tooltipTop
          ? 'translate-x-3 translate-y-[calc(-100%-12px)]'
          : 'translate-x-3 translate-y-3'

  return (
    <div className={cls.root}>
      {/* ── Info panel ── */}
      <aside className={cls.panel}>
        <h2 className={cls.panelTitle}>LOD Debug</h2>

        <section className={cls.section}>
          <div className={cls.sectionLabel}>缩放</div>
          <InfoRow label='k (实际)' value={viewport.k.toFixed(4)} />
          <InfoRow label='LOD n' value={`${lodLevelN >= 0 ? '+' : ''}${lodLevelN}`} />
          <InfoRow label='snap k' value={`2^(${lodLevelN}/4) = ${snappedK.toFixed(4)}`} />
          <div className={cls.formula}>2^(round(log₂(k) × 4) / 4)</div>
        </section>

        <section className={cls.section}>
          <div className={cls.sectionLabel}>网格</div>
          <InfoRow label='格子屏幕尺寸' value={`${effectiveSize.toFixed(1)} px`} />
          <InfoRow
            label='计算'
            value={`${CELL_SIZE} × (${viewport.k.toFixed(3)} / ${snappedK.toFixed(3)})`}
          />
          <InfoRow label='D3坐标覆盖/格' value={`${(CELL_SIZE / snappedK).toFixed(2)} 单位`} />
          <InfoRow label='占用格子 (全)' value={String(gridCells.size)} />
          <InfoRow label='可见格子' value={String(cellRects.length)} />
        </section>

        <section className={cls.section}>
          <div className={cls.sectionLabel}>数据</div>
          <InfoRow label='总点数' value={String(points.length)} />
          <InfoRow label='train' value={String(trainCount)} accent={SPLIT_COLORS.train} />
          <InfoRow label='val' value={String(valCount)} accent={SPLIT_COLORS.val} />
          <InfoRow label='LOD 代表点' value={String(gridCells.size)} />
          <InfoRow
            label='压缩比'
            value={
              points.length > 0
                ? `${((1 - gridCells.size / points.length) * 100).toFixed(1)}%`
                : '—'
            }
          />
        </section>

        {hovered && (
          <section className={cls.section}>
            <div className={cls.sectionLabel}>悬停</div>
            <div className={cls.sceneName}>{hovered.point.scene_name}</div>
            <InfoRow
              label='split'
              value={hovered.point.split}
              accent={SPLIT_COLORS[hovered.point.split]}
            />
            <InfoRow
              label='t-SNE'
              value={`(${hovered.point.tsne_comp1.toFixed(3)}, ${hovered.point.tsne_comp2.toFixed(3)})`}
            />
            <InfoRow
              label='屏幕坐标'
              value={`(${hovered.screenX.toFixed(1)}, ${hovered.screenY.toFixed(1)})`}
            />
            <InfoRow label='格子 (ci, cj)' value={`(${hovered.ci}, ${hovered.cj})`} />
            <InfoRow label='当前LOD代表点' value={hovered.isRepresentative ? '✓ 是' : '✗ 否'} />
          </section>
        )}
      </aside>

      {/* ── Canvas ── */}
      <div className={cls.canvasWrapper}>
        <svg
          ref={svgRef}
          className={cls.canvas}
          viewBox={`0 0 ${VIEWBOX_WIDTH} ${VIEWBOX_HEIGHT}`}
          style={{ '--scatter-r': String(POINT_RADIUS) } as React.CSSProperties}
          onMouseMove={handleMouseMove}
          onMouseLeave={handleMouseLeave}
        >
          <rect className={cls.bg} width={VIEWBOX_WIDTH} height={VIEWBOX_HEIGHT} />

          {/* ── Grid layer (screen-space, outside zoom transform) ── */}
          <g>
            {/* Occupied cell fills */}
            {cellRects.map(({ x, y, size, point }) => (
              <rect
                key={point.scene_name}
                x={x}
                y={y}
                width={size}
                height={size}
                className={cls.cellFill}
                style={{ fill: SPLIT_COLORS[point.split] }}
              />
            ))}

            {/* Vertical lines */}
            {vLines.map(x => (
              <line
                key={`v${x.toFixed(2)}`}
                x1={x}
                y1={0}
                x2={x}
                y2={VIEWBOX_HEIGHT}
                className={cls.gridLine}
              />
            ))}

            {/* Horizontal lines */}
            {hLines.map(y => (
              <line
                key={`h${y.toFixed(2)}`}
                x1={0}
                y1={y}
                x2={VIEWBOX_WIDTH}
                y2={y}
                className={cls.gridLine}
              />
            ))}

            {/* Cell center cross-hair markers */}
            {cellRects.map(({ x, y, size, point }) => {
              const cx = x + size / 2
              const cy = y + size / 2
              return (
                <g key={`ctr-${point.scene_name}`}>
                  <line x1={cx - 4} y1={cy} x2={cx + 4} y2={cy} className={cls.cellCross} />
                  <line x1={cx} y1={cy - 4} x2={cx} y2={cy + 4} className={cls.cellCross} />
                </g>
              )
            })}
          </g>

          {/* ── Scatter dots (zoom-transformed) ── */}
          <g ref={scatterGroupRef} className={cls.zoomLayer}>
            <ScatterDots
              points={points}
              scales={scales}
              representativeNames={representativeNames}
            />
          </g>

          {/* ── Hover overlays (screen-space) ── */}
          {hovered && (
            <g>
              {/* Highlight the cell */}
              <rect
                x={hovered.ci * effectiveSize + viewport.tx}
                y={hovered.cj * effectiveSize + viewport.ty}
                width={effectiveSize}
                height={effectiveSize}
                className={cls.hoverCell}
              />
              {/* Ring around the point */}
              <circle cx={hovered.screenX} cy={hovered.screenY} r={9} className={cls.hoverRing} />
            </g>
          )}
        </svg>

        {/* ── Floating tooltip ── */}
        {hovered && (
          <div
            className={`${cls.tooltip} ${tooltipTransform}`}
            style={{
              left: `${(hovered.screenX / VIEWBOX_WIDTH) * 100}%`,
              top: `${(hovered.screenY / VIEWBOX_HEIGHT) * 100}%`
            }}
          >
            <div className={cls.tooltipName}>{hovered.point.scene_name}</div>
            <div className={cls.tooltipRow}>
              <span className={cls.tooltipKey}>split</span>
              <span style={{ color: SPLIT_COLORS[hovered.point.split] }}>
                {hovered.point.split}
              </span>
            </div>
            <div className={cls.tooltipRow}>
              <span className={cls.tooltipKey}>t-SNE x</span>
              <span>{hovered.point.tsne_comp1.toFixed(4)}</span>
            </div>
            <div className={cls.tooltipRow}>
              <span className={cls.tooltipKey}>t-SNE y</span>
              <span>{hovered.point.tsne_comp2.toFixed(4)}</span>
            </div>
            <div className={cls.tooltipRow}>
              <span className={cls.tooltipKey}>cell</span>
              <span>
                ({hovered.ci}, {hovered.cj})
              </span>
            </div>
            <div className={cls.tooltipRow}>
              <span className={cls.tooltipKey}>代表点</span>
              <span className={hovered.isRepresentative ? cls.repYes : cls.repNo}>
                {hovered.isRepresentative ? '✓ 是' : '✗ 否'}
              </span>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
