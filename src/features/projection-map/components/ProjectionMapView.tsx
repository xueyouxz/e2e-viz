import {
  startTransition,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState
} from 'react'
import * as d3 from 'd3'
import { CategoryBarChart, type BarDatum } from '@/shared/components/charts/CategoryBarChart'
import styles from './ProjectionMapView.module.css'
import type { ProjectionMapPoint, SplitName } from '../types/vectorMap.types'

type ProjectionMapViewProps = {
  points: ProjectionMapPoint[]
  selectedScenes: ProjectionMapPoint[]
  onGlyphClick?: (sceneName: string) => void
  onSelectionChange?: (scenes: ProjectionMapPoint[]) => void
}

type Viewport = {
  x0: number
  x1: number
  y0: number
  y1: number
  k: number
  tx: number
  ty: number
}

type ScalePair = {
  x: d3.ScaleLinear<number, number>
  y: d3.ScaleLinear<number, number>
}

const VIEWBOX_WIDTH = 1280
const VIEWBOX_HEIGHT = 760
const CHART_PADDING = 58
const POINT_RADIUS = 4
const MAP_GLYPH_SIZE = 44
const CELL_SIZE = 52
const LOD_GLYPH_MIN_K = 0.7
const GLYPH_BASE = '/data/glyphs/'

// matplotlib tab10 C0/C1 — standard academic chart palette
const SPLIT_COLORS: Record<SplitName, string> = { train: '#1f77b4', val: '#d62728' }

// ─── Lasso helpers ────────────────────────────────────────────────────────────

type Vec2 = [number, number]

/** Convert a pointer clientX/Y to SVG viewBox coordinates. */
function toViewBox(svg: SVGSVGElement, clientX: number, clientY: number): Vec2 {
  const r = svg.getBoundingClientRect()
  return [
    ((clientX - r.left) / r.width) * VIEWBOX_WIDTH,
    ((clientY - r.top) / r.height) * VIEWBOX_HEIGHT
  ]
}

/** Ray-casting point-in-polygon test. */
function pointInPolygon(px: number, py: number, poly: Vec2[]): boolean {
  let inside = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i],
      [xj, yj] = poly[j]
    if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

/** Build a closed SVG path `d` attribute from a list of viewBox points. */
function polyToPathD(poly: Vec2[]): string {
  if (poly.length < 2) return ''
  return poly.map((v, i) => `${i ? 'L' : 'M'}${v[0].toFixed(1)},${v[1].toFixed(1)}`).join('') + 'Z'
}

const FIT_PADDING = 72 // viewBox units added around the selection bbox

/** Compute a ZoomTransform that centres and fits the given points in the viewport. */
function computeFitTransform(pts: ProjectionMapPoint[], sc: ScalePair): d3.ZoomTransform {
  const xs = pts.map(p => sc.x(p.tsne_comp1))
  const ys = pts.map(p => sc.y(p.tsne_comp2))
  const x0 = Math.min(...xs),
    x1 = Math.max(...xs)
  const y0 = Math.min(...ys),
    y1 = Math.max(...ys)
  const bw = Math.max(x1 - x0, 1) + FIT_PADDING * 2
  const bh = Math.max(y1 - y0, 1) + FIT_PADDING * 2
  const k = Math.min(VIEWBOX_WIDTH / bw, VIEWBOX_HEIGHT / bh, 8)
  const cx = (x0 + x1) / 2,
    cy = (y0 + y1) / 2
  return d3.zoomIdentity.translate(VIEWBOX_WIDTH / 2 - cx * k, VIEWBOX_HEIGHT / 2 - cy * k).scale(k)
}

// ─── Grid helpers ─────────────────────────────────────────────────────────────

function formatTransform(t: d3.ZoomTransform): string {
  return `translate(${t.x} ${t.y}) scale(${t.k})`
}

function computeViewport(t: d3.ZoomTransform): Viewport {
  return {
    x0: -t.x / t.k,
    x1: (VIEWBOX_WIDTH - t.x) / t.k,
    y0: -t.y / t.k,
    y1: (VIEWBOX_HEIGHT - t.y) / t.k,
    k: t.k,
    tx: t.x,
    ty: t.y
  }
}

function snapGridK(k: number): number {
  return Math.pow(2, Math.round(Math.log2(k) * 4) / 4)
}

const SNAP_LEVELS: readonly number[] = Array.from({ length: 21 }, (_, i) =>
  Math.pow(2, (i - 4) / 4)
)

type GridIndex = Map<number, Map<string, ProjectionMapPoint>>

function buildGridIndex(pts: ProjectionMapPoint[], sc: ScalePair): GridIndex {
  const index: GridIndex = new Map()
  for (const k of SNAP_LEVELS) index.set(k, computeGridCells(pts, sc, k))
  return index
}

function computeGridCells(
  points: ProjectionMapPoint[],
  sc: ScalePair,
  k: number
): Map<string, ProjectionMapPoint> {
  const best = new Map<string, { point: ProjectionMapPoint; dist2: number }>()
  for (const point of points) {
    const sx = sc.x(point.tsne_comp1) * k
    const sy = sc.y(point.tsne_comp2) * k
    const ci = Math.floor(sx / CELL_SIZE),
      cj = Math.floor(sy / CELL_SIZE)
    const key = `${ci},${cj}`
    const d2 = (sx - (ci + 0.5) * CELL_SIZE) ** 2 + (sy - (cj + 0.5) * CELL_SIZE) ** 2
    const ex = best.get(key)
    if (!ex || d2 < ex.dist2) best.set(key, { point, dist2: d2 })
  }
  const result = new Map<string, ProjectionMapPoint>()
  for (const [key, { point }] of best) result.set(key, point)
  return result
}

const LassoIcon = () => (
  <svg
    className={styles.lassoIcon}
    viewBox='0 0 1024 1024'
    version='1.1'
    xmlns='http://www.w3.org/2000/svg'
  >
    <path d='M70.582857 461.421714c0 196.717714 168.850286 307.291429 379.702857 307.291429 16.274286 0 33.005714-0.859429 49.718857-1.718857 17.554286 7.296 38.582857 11.574857 62.134858 11.574857 64.292571 0 129.426286-17.993143 187.282285-48.859429 1.28 6.436571 1.718857 13.293714 1.718857 20.150857 0 51.419429-29.147429 101.558857-77.147428 132.004572-12.434286 8.996571-21.430857 17.993143-21.430857 33.426286 0 15.853714 12.873143 29.568 33.005714 29.568 9.435429 0 14.994286-2.56 23.149714-7.716572 66.011429-42.861714 106.715429-114.432 106.715429-188.580571 0-19.712-2.56-38.125714-7.716572-55.698286 86.125714-65.572571 145.718857-162.011429 145.718858-267.867429 0-203.995429-181.723429-345.856-398.994286-345.856-237.860571 0-483.876571 155.995429-483.876572 382.281143z m64.713143 0.438857c0-186.861714 214.272-317.988571 419.565714-317.988571 179.565714 0 334.281143 111.414857 334.281143 280.685714 0 81.005714-45.421714 156.013714-111.433143 209.590857-35.986286-47.579429-94.281143-77.568-161.572571-77.568-98.139429 0-172.288 51.419429-172.288 127.268572 0 7.296 0.859429 14.153143 2.578286 20.571428C275.437714 702.281143 135.314286 621.714286 135.314286 461.860571zM509.001143 681.691429c0-35.986286 50.139429-59.995429 112.274286-59.995429 42.861714 0 79.725714 18.432 103.314285 48.420571-50.157714 27.867429-107.154286 44.141714-162.450285 44.141715-30.848 0-53.138286-11.995429-53.138286-32.548572z' />
  </svg>
)

// ─── Component ───────────────────────────────────────────────────────────────

export function ProjectionMapView({
  points,
  selectedScenes,
  onGlyphClick,
  onSelectionChange
}: ProjectionMapViewProps) {
  const [activeIds, setActiveIds] = useState<string[]>(['train', 'val'])
  const [lassoActive, setLassoActive] = useState(false)

  const showTrain = activeIds.includes('train')
  const showVal = activeIds.includes('val')

  const svgRef = useRef<SVGSVGElement | null>(null)
  const scatterGroupRef = useRef<SVGGElement | null>(null)
  const glyphGroupRef = useRef<SVGGElement | null>(null)
  const lassoPathRef = useRef<SVGPathElement | null>(null)
  const transformRef = useRef(d3.zoomIdentity)
  const zoomRafRef = useRef<number | null>(null)
  const zoomRef = useRef<d3.ZoomBehavior<SVGSVGElement, unknown> | null>(null)

  // Always-current refs used inside event handlers and D3 callbacks.
  const lassoActiveRef = useRef(lassoActive)
  const onGlyphClickRef = useRef(onGlyphClick)
  const onSelectionChangeRef = useRef(onSelectionChange)
  const scalesRef = useRef<ScalePair | null>(null)
  const pointsRef = useRef(points)
  const visiblePointsRef = useRef<ProjectionMapPoint[]>([])
  useLayoutEffect(() => {
    lassoActiveRef.current = lassoActive
    onGlyphClickRef.current = onGlyphClick
    onSelectionChangeRef.current = onSelectionChange
    pointsRef.current = points
    visiblePointsRef.current = visibleGlyphPoints
  })

  // Lasso drawing state — managed imperatively to avoid re-renders during draw.
  const isDrawingRef = useRef(false)
  const lassoDraftRef = useRef<Vec2[]>([])
  // Lasso polygon in data space — reprojected to screen on every zoom event.
  const lassoDataPolyRef = useRef<Vec2[]>([])

  // ─── Viewport state ──────────────────────────────────────────────────────────

  const [viewport, setViewport] = useState<Viewport>({
    x0: -Infinity,
    x1: Infinity,
    y0: -Infinity,
    y1: Infinity,
    k: 1,
    tx: 0,
    ty: 0
  })

  // ─── Scales ──────────────────────────────────────────────────────────────────

  const scales = useMemo<ScalePair>(() => {
    const xExt = d3.extent(points, p => p.tsne_comp1)
    const yExt = d3.extent(points, p => p.tsne_comp2)
    const sc: ScalePair = {
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
    scalesRef.current = sc
    return sc
  }, [points])

  // ─── Derived lists ───────────────────────────────────────────────────────────

  const valPoints = useMemo(() => points.filter(p => p.split === 'val'), [points])
  const trainPoints = useMemo(() => points.filter(p => p.split === 'train'), [points])

  const visibleGlyphPoints = useMemo(() => {
    if (showTrain && showVal) return points
    if (showTrain) return trainPoints
    if (showVal) return valPoints
    return []
  }, [showTrain, showVal, points, valPoints, trainPoints])

  // ─── Grid index ──────────────────────────────────────────────────────────────

  const gridIndex = useMemo(
    () => ({
      val: buildGridIndex(valPoints, scales),
      train: buildGridIndex(trainPoints, scales),
      all: buildGridIndex(points, scales)
    }),
    [points, scales, valPoints, trainPoints]
  )

  const glyphsActive = viewport.k >= LOD_GLYPH_MIN_K
  const snappedK = snapGridK(viewport.k)

  const gridCells = useMemo(() => {
    if (!glyphsActive) return new Map<string, ProjectionMapPoint>()
    const idx =
      showTrain && showVal
        ? gridIndex.all
        : showTrain
          ? gridIndex.train
          : showVal
            ? gridIndex.val
            : null
    return idx?.get(snappedK) ?? new Map<string, ProjectionMapPoint>()
  }, [glyphsActive, showTrain, showVal, gridIndex, snappedK])

  // ─── Density heatmap ─────────────────────────────────────────────────────────

  const densityPoints = useMemo(() => {
    if (showTrain && showVal) return points
    if (showTrain) return trainPoints
    if (showVal) return valPoints
    return []
  }, [showTrain, showVal, points, valPoints, trainPoints])

  const densityContours = useMemo(() => {
    if (!densityPoints.length) return []
    const density = d3
      .contourDensity<ProjectionMapPoint>()
      .x(d => scales.x(d.tsne_comp1))
      .y(d => scales.y(d.tsne_comp2))
      .size([VIEWBOX_WIDTH, VIEWBOX_HEIGHT])
      .bandwidth(28)
      .thresholds(18)
    return density(densityPoints)
  }, [densityPoints, scales])

  const densityGeoPath = useMemo(() => d3.geoPath(), [])

  const densityColor = useMemo(() => {
    if (!densityContours.length) return (_: number) => 'transparent'
    return d3
      .scaleSequential(d3.interpolateRgb('#f0f2f7', '#7b93b8'))
      .domain([0, densityContours[densityContours.length - 1].value])
  }, [densityContours])

  // ─── Culling ─────────────────────────────────────────────────────────────────

  const culledGlyphPoints = useMemo(() => {
    if (!glyphsActive) return []
    const half = MAP_GLYPH_SIZE / 2
    const { k, tx, ty } = viewport
    return [...gridCells.values()].filter(p => {
      const sx = scales.x(p.tsne_comp1) * k + tx
      const sy = scales.y(p.tsne_comp2) * k + ty
      return sx >= -half && sx <= VIEWBOX_WIDTH + half && sy >= -half && sy <= VIEWBOX_HEIGHT + half
    })
  }, [glyphsActive, gridCells, scales, viewport])

  // Scatter dots live inside scatterGroupRef (D3-transformed), so the browser
  // clips any outside the viewBox automatically — no per-frame culling needed.
  const culledScatterPoints = useMemo(
    () => (glyphsActive ? [] : visibleGlyphPoints),
    [glyphsActive, visibleGlyphPoints]
  )

  // ─── Selection set ───────────────────────────────────────────────────────────

  const selectedSet = useMemo(
    () => new Set(selectedScenes.map(s => s.scene_name)),
    [selectedScenes]
  )

  // ─── Split bar chart data ─────────────────────────────────────────────────────

  // Single pass over selectedScenes to count both splits at once.
  const splitSelectedCounts = useMemo(() => {
    const counts = { train: 0, val: 0 }
    for (const s of selectedScenes) {
      if (s.split === 'train') counts.train++
      else if (s.split === 'val') counts.val++
    }
    return counts
  }, [selectedScenes])

  // When a split is inactive its selected count is zeroed so the bar immediately
  // resets to default state and the pill reverts to showing the total.
  const chartBars = useMemo<BarDatum[]>(() => {
    const trainActive = activeIds.includes('train')
    const valActive = activeIds.includes('val')
    return [
      {
        id: 'train',
        label: 'Train',
        color: SPLIT_COLORS.train,
        total: trainPoints.length,
        selected: trainActive ? splitSelectedCounts.train : 0
      },
      {
        id: 'val',
        label: 'Val',
        color: SPLIT_COLORS.val,
        total: valPoints.length,
        selected: valActive ? splitSelectedCounts.val : 0
      }
    ]
  }, [trainPoints.length, valPoints.length, splitSelectedCounts, activeIds])

  // At least one split must remain active — guard prevents an empty map state.
  const handleBarClick = useCallback((id: string) => {
    startTransition(() => {
      setActiveIds(prev => {
        if (prev.includes(id) && prev.length === 1) return prev
        return prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
      })
    })
  }, [])

  // When a split is toggled back on while a lasso polygon exists, re-evaluate
  // which of the newly visible points fall inside the polygon so that the bar
  // chart immediately reflects the correct selected proportion.
  useEffect(() => {
    const dp = lassoDataPolyRef.current
    if (dp.length === 0) return
    const t = transformRef.current
    const sc = scalesRef.current
    if (!sc) return
    const screenPoly = dp.map(([dx, dy]): Vec2 => [sc.x(dx) * t.k + t.x, sc.y(dy) * t.k + t.y])
    const selected = visibleGlyphPoints.filter(p =>
      pointInPolygon(sc.x(p.tsne_comp1) * t.k + t.x, sc.y(p.tsne_comp2) * t.k + t.y, screenPoly)
    )
    onSelectionChangeRef.current?.(selected)
  }, [visibleGlyphPoints])

  // ─── D3 glyph join ───────────────────────────────────────────────────────────

  useEffect(() => {
    if (!glyphGroupRef.current) return

    const { k, tx, ty } = viewport
    const half = MAP_GLYPH_SIZE / 2
    const toTranslate = (d: ProjectionMapPoint) => {
      const x = scales.x(d.tsne_comp1) * k + tx - half
      const y = scales.y(d.tsne_comp2) * k + ty - half
      return `translate(${x},${y})`
    }

    const joined = d3
      .select(glyphGroupRef.current)
      .selectAll<SVGGElement, ProjectionMapPoint>('g.glyph')
      .data(culledGlyphPoints, d => d.scene_name)

    joined.exit().remove()

    const entered = joined
      .enter()
      .append('g')
      .attr('class', `glyph ${styles.glyphGroup}`)
      .attr('transform', toTranslate)
      .style('pointer-events', 'all')
      .on('click', (_event, d) => {
        onGlyphClickRef.current?.(d.scene_name)
      })
      // raise() keeps the hovered glyph above siblings; scale is handled by CSS.
      .on('mouseenter', function () {
        d3.select(this).raise()
      })
      .on('mouseleave', null)

    entered
      .append('image')
      .attr('href', d => `${GLYPH_BASE}${d.scene_name}.webp`)
      .attr('width', MAP_GLYPH_SIZE)
      .attr('height', MAP_GLYPH_SIZE)
      .attr('class', styles.glyphImage)

    // No transition on update — the zoom handler repositions every frame
    // imperatively; mixing D3 transitions with direct attr() writes causes
    // flickering as both compete to set the same transform attribute.
    joined.interrupt().attr('transform', toTranslate)
  }, [culledGlyphPoints, snappedK, scales, viewport])

  // Keep selected-glyph class in sync with selectedSet.
  useEffect(() => {
    if (!glyphGroupRef.current) return
    d3.select(glyphGroupRef.current)
      .selectAll<SVGGElement, ProjectionMapPoint>('g.glyph')
      .classed(styles.glyphGroupSelected, d => selectedSet.has(d.scene_name))
  }, [selectedSet])

  // ─── Zoom setup ──────────────────────────────────────────────────────────────

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
      // In lasso mode: allow scroll-wheel zoom but block pointer-drag pan.
      .filter(event => (lassoActiveRef.current ? event.type === 'wheel' : !event.button))
      .on('zoom', (event: d3.D3ZoomEvent<SVGSVGElement, unknown>) => {
        const prevT = transformRef.current
        const t = event.transform
        transformRef.current = t

        // ── Imperative DOM updates (every frame, no React re-render) ──────────
        scatterGroupRef.current?.setAttribute('transform', formatTransform(t))
        svgRef.current?.style.setProperty('--scatter-r', String(POINT_RADIUS / t.k))
        svgRef.current?.style.setProperty('--sel-r', String((POINT_RADIUS * 0.52) / t.k))

        // Reposition glyphs directly — avoids React re-render for pan/zoom.
        const sc = scalesRef.current
        if (glyphGroupRef.current && sc) {
          const half = MAP_GLYPH_SIZE / 2
          d3.select(glyphGroupRef.current)
            .selectAll<SVGGElement, ProjectionMapPoint>('g.glyph')
            .attr('transform', d => {
              const x = sc.x(d.tsne_comp1) * t.k + t.x - half
              const y = sc.y(d.tsne_comp2) * t.k + t.y - half
              return `translate(${x},${y})`
            })
        }

        // Reproject lasso polygon from data space → current screen space.
        const dp = lassoDataPolyRef.current
        if (dp.length > 0 && sc && lassoPathRef.current) {
          const screenPoly = dp.map(
            ([dx, dy]): Vec2 => [sc.x(dx) * t.k + t.x, sc.y(dy) * t.k + t.y]
          )
          lassoPathRef.current.setAttribute('d', polyToPathD(screenPoly))
        }

        // ── React state update — only when LOD mode or grid snap level changes ─
        // Skipping every-frame setViewport eliminates ~60 re-renders/s during zoom.
        const prevGlyphsActive = prevT.k >= LOD_GLYPH_MIN_K
        const newGlyphsActive = t.k >= LOD_GLYPH_MIN_K
        const prevSnap = snapGridK(prevT.k)
        const newSnap = snapGridK(t.k)
        if (newGlyphsActive !== prevGlyphsActive || newSnap !== prevSnap) {
          if (zoomRafRef.current !== null) cancelAnimationFrame(zoomRafRef.current)
          zoomRafRef.current = requestAnimationFrame(() => {
            zoomRafRef.current = null
            setViewport(computeViewport(transformRef.current))
          })
        }
      })
      .on('end', () => {
        // Final viewport sync on gesture end — corrects culling after pan.
        if (zoomRafRef.current !== null) {
          cancelAnimationFrame(zoomRafRef.current)
          zoomRafRef.current = null
        }
        setViewport(computeViewport(transformRef.current))
      })

    zoomRef.current = zoom
    svg.call(zoom)
    return () => {
      svg.on('.zoom', null)
      if (zoomRafRef.current !== null) cancelAnimationFrame(zoomRafRef.current)
    }
  }, [])

  // Cancel any in-progress lasso when the mode is toggled off externally.
  useEffect(() => {
    if (!lassoActive) {
      isDrawingRef.current = false
      lassoDraftRef.current = []
      clearLasso()
    }
  }, [lassoActive])

  // Clear lasso path when selection is cleared externally.
  useEffect(() => {
    if (selectedScenes.length === 0) clearLasso()
  }, [selectedScenes])

  // ─── Lasso pointer handlers ───────────────────────────────────────────────────

  function handlePointerDown(e: React.PointerEvent<SVGSVGElement>) {
    if (!lassoActiveRef.current || e.button !== 0 || !svgRef.current) return
    // Interrupt any ongoing zoom-to-fit animation so the new lasso starts clean.
    d3.select(svgRef.current).interrupt()
    clearLasso()
    e.currentTarget.setPointerCapture(e.pointerId)
    isDrawingRef.current = true
    lassoDraftRef.current = [toViewBox(svgRef.current, e.clientX, e.clientY)]
  }

  function handlePointerMove(e: React.PointerEvent<SVGSVGElement>) {
    if (!isDrawingRef.current || !svgRef.current || !lassoPathRef.current) return
    lassoDraftRef.current.push(toViewBox(svgRef.current, e.clientX, e.clientY))
    lassoPathRef.current.setAttribute('d', polyToPathD(lassoDraftRef.current))
  }

  function clearLasso() {
    lassoDataPolyRef.current = []
    lassoPathRef.current?.setAttribute('d', '')
  }

  function handlePointerUp() {
    if (!isDrawingRef.current) return
    isDrawingRef.current = false

    const poly = lassoDraftRef.current
    lassoDraftRef.current = []
    if (poly.length < 6) {
      clearLasso()
      return
    }

    const t = transformRef.current
    const sc = scalesRef.current
    if (!sc) {
      clearLasso()
      return
    }

    const selected = visiblePointsRef.current.filter(p => {
      const sx = sc.x(p.tsne_comp1) * t.k + t.x
      const sy = sc.y(p.tsne_comp2) * t.k + t.y
      return pointInPolygon(sx, sy, poly)
    })
    onSelectionChangeRef.current?.(selected)

    if (selected.length > 0) {
      // Convert screen-space polygon → data space so it tracks zoom/pan.
      lassoDataPolyRef.current = poly.map(
        ([sx, sy]): Vec2 => [sc.x.invert((sx - t.x) / t.k), sc.y.invert((sy - t.y) / t.k)]
      )
      // Animate zoom to fit the selected region.
      if (svgRef.current && zoomRef.current) {
        const target = computeFitTransform(selected, sc)
        d3.select(svgRef.current)
          .transition()
          .duration(680)
          .ease(d3.easeCubicInOut)
          .call(zoomRef.current.transform, target)
      }
    } else {
      clearLasso()
    }
  }

  // ─── Render ──────────────────────────────────────────────────────────────────

  return (
    <section className={styles.panel}>
      {/* Top-left: lasso tool — pill style matching scene-viewer toolbar */}
      <div className={styles.lassoOverlay}>
        <div className={styles.toolPill}>
          <button
            type='button'
            className={`${styles.toolBtn} ${lassoActive ? styles.toolBtnActive : ''}`}
            onClick={() => setLassoActive(v => !v)}
            title='Lasso select'
          >
            <LassoIcon />
          </button>
        </div>
      </div>

      {/* Top-right: split distribution bar chart */}
      <div className={styles.controlsOverlay}>
        <div className={styles.toolPill}>
          <CategoryBarChart bars={chartBars} activeIds={activeIds} onBarClick={handleBarClick} />
        </div>
      </div>

      <svg
        ref={svgRef}
        className={styles.canvas}
        viewBox={`0 0 ${VIEWBOX_WIDTH} ${VIEWBOX_HEIGHT}`}
        style={
          {
            '--scatter-r': String(POINT_RADIUS),
            '--sel-r': String(POINT_RADIUS * 0.52),
            cursor: lassoActive ? 'crosshair' : undefined
          } as React.CSSProperties
        }
        role='img'
        aria-label='Training and validation scene projection view'
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
      >
        <defs>
          {/* Selection filter: 30% blue tint over glyph, clipped to image bounds */}
          <filter id='glyph-selected-filter' colorInterpolationFilters='sRGB'>
            <feFlood floodColor='#2563eb' floodOpacity='0.3' result='blueTint' />
            <feComposite operator='in' in='blueTint' in2='SourceAlpha' result='clippedTint' />
            <feComposite operator='over' in='clippedTint' in2='SourceGraphic' />
          </filter>
        </defs>
        <rect className={styles.canvasBackground} width={VIEWBOX_WIDTH} height={VIEWBOX_HEIGHT} />

        <g ref={scatterGroupRef} className={styles.zoomLayer}>
          {/* Density heatmap — neutral gray-blue isocontours as background */}
          <g opacity={0.6}>
            {densityContours.map((contour, i) => (
              <path
                key={i}
                d={densityGeoPath(contour) ?? ''}
                fill={densityColor(contour.value)}
                stroke='none'
              />
            ))}
          </g>

          {/* Scatter dots */}
          {culledScatterPoints.map(point => (
            <circle
              key={point.scene_name}
              className={styles.scatterDot}
              cx={scales.x(point.tsne_comp1)}
              cy={scales.y(point.tsne_comp2)}
              fill={SPLIT_COLORS[point.split]}
              opacity={0.55}
            />
          ))}

          {/* Selected scene dots — mutually exclusive with glyphs */}
          {!glyphsActive &&
            selectedScenes.map(p => (
              <circle
                key={`sel-${p.scene_name}`}
                className={styles.selectedDot}
                cx={scales.x(p.tsne_comp1)}
                cy={scales.y(p.tsne_comp2)}
                fill={SPLIT_COLORS[p.split]}
              />
            ))}
        </g>

        {/* Glyph layer — screen-space, D3-managed */}
        <g ref={glyphGroupRef} className={styles.glyphLayer} />

        {/* Lasso path — always in DOM, updated imperatively during draw */}
        <path ref={lassoPathRef} className={styles.lassoPath} />
      </svg>
    </section>
  )
}
