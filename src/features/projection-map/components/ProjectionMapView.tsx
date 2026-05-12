import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import * as d3 from 'd3'
import styles from './ProjectionMapView.module.css'
import type { ProjectionMapPoint, SplitName } from '../types/vectorMap.types'

type ProjectionMapViewProps = {
  points: ProjectionMapPoint[]
  selectedScenes: ProjectionMapPoint[]
  onGlyphClick?: (sceneName: string) => void
  onSelectionChange: (scenes: ProjectionMapPoint[]) => void
}

type Viewport = {
  x0: number; x1: number
  y0: number; y1: number
  k: number; tx: number; ty: number
}

type ScalePair = {
  x: d3.ScaleLinear<number, number>
  y: d3.ScaleLinear<number, number>
}

const VIEWBOX_WIDTH   = 1280
const VIEWBOX_HEIGHT  = 760
const CHART_PADDING   = 58
const POINT_RADIUS    = 4
const MAP_GLYPH_SIZE  = 44
const CELL_SIZE       = 52
const LOD_GLYPH_MIN_K = 0.7
const REPOSITION_DURATION = 280
const REPOSITION_EASE     = d3.easeQuadOut
const GLYPH_BASE = '/data/glyphs/'

// matplotlib tab10 C0/C1 — standard academic chart palette
const SPLIT_COLORS: Record<SplitName, string> = { train: '#1f77b4', val: '#d62728' }

// ─── Lasso helpers ────────────────────────────────────────────────────────────

type Vec2 = [number, number]

/** Convert a pointer clientX/Y to SVG viewBox coordinates. */
function toViewBox(svg: SVGSVGElement, clientX: number, clientY: number): Vec2 {
  const r = svg.getBoundingClientRect()
  return [
    (clientX - r.left) / r.width  * VIEWBOX_WIDTH,
    (clientY - r.top)  / r.height * VIEWBOX_HEIGHT,
  ]
}

/** Ray-casting point-in-polygon test. */
function pointInPolygon(px: number, py: number, poly: Vec2[]): boolean {
  let inside = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j]
    if ((yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi)
      inside = !inside
  }
  return inside
}

/** Build a closed SVG path `d` attribute from a list of viewBox points. */
function polyToPathD(poly: Vec2[]): string {
  if (poly.length < 2) return ''
  return poly.map((v, i) => `${i ? 'L' : 'M'}${v[0].toFixed(1)},${v[1].toFixed(1)}`).join('') + 'Z'
}

const HULL_PADDING = 28  // viewBox units of outward expansion per hull vertex

/**
 * Compute a smooth Catmull-Rom closed path around the convex hull of the
 * given points, expanded outward by HULL_PADDING. Returns '' for no points.
 */
function computeHullPath(pts: ProjectionMapPoint[], sc: ScalePair): string {
  if (pts.length === 0) return ''
  const coords = pts.map(p => [sc.x(p.tsne_comp1), sc.y(p.tsne_comp2)] as Vec2)
  if (coords.length === 1) {
    const [x, y] = coords[0], r = HULL_PADDING
    return `M${x - r},${y} A${r},${r},0,1,1,${x + r},${y} A${r},${r},0,1,1,${x - r},${y}Z`
  }
  const hull = d3.polygonHull(coords) ?? coords
  const cx   = hull.reduce((s, [x]) => s + x, 0) / hull.length
  const cy   = hull.reduce((s, [, y]) => s + y, 0) / hull.length
  const expanded = hull.map(([x, y]): Vec2 => {
    const dx = x - cx, dy = y - cy
    const len = Math.hypot(dx, dy) || 1
    return [x + (dx / len) * HULL_PADDING, y + (dy / len) * HULL_PADDING]
  })
  return (
    d3.line<Vec2>()
      .x(d => d[0]).y(d => d[1])
      .curve(d3.curveCatmullRomClosed.alpha(0.5))(expanded) ?? ''
  )
}

const FIT_PADDING = 72  // viewBox units added around the selection bbox

/** Compute a ZoomTransform that centres and fits the given points in the viewport. */
function computeFitTransform(pts: ProjectionMapPoint[], sc: ScalePair): d3.ZoomTransform {
  const xs = pts.map(p => sc.x(p.tsne_comp1))
  const ys = pts.map(p => sc.y(p.tsne_comp2))
  const x0 = Math.min(...xs), x1 = Math.max(...xs)
  const y0 = Math.min(...ys), y1 = Math.max(...ys)
  const bw = Math.max(x1 - x0, 1) + FIT_PADDING * 2
  const bh = Math.max(y1 - y0, 1) + FIT_PADDING * 2
  const k  = Math.min(VIEWBOX_WIDTH / bw, VIEWBOX_HEIGHT / bh, 8)
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2
  return d3.zoomIdentity
    .translate(VIEWBOX_WIDTH / 2 - cx * k, VIEWBOX_HEIGHT / 2 - cy * k)
    .scale(k)
}

// ─── Grid helpers ─────────────────────────────────────────────────────────────

function formatTransform(t: d3.ZoomTransform): string {
  return `translate(${t.x} ${t.y}) scale(${t.k})`
}

function computeViewport(t: d3.ZoomTransform): Viewport {
  return {
    x0: -t.x / t.k,      x1: (VIEWBOX_WIDTH  - t.x) / t.k,
    y0: -t.y / t.k,      y1: (VIEWBOX_HEIGHT - t.y) / t.k,
    k: t.k, tx: t.x, ty: t.y,
  }
}

function snapGridK(k: number): number {
  return Math.pow(2, Math.round(Math.log2(k) * 4) / 4)
}

const SNAP_LEVELS: readonly number[] = Array.from({ length: 21 }, (_, i) => Math.pow(2, (i - 4) / 4))

type GridIndex = Map<number, Map<string, ProjectionMapPoint>>

function buildGridIndex(pts: ProjectionMapPoint[], sc: ScalePair): GridIndex {
  const index: GridIndex = new Map()
  for (const k of SNAP_LEVELS) index.set(k, computeGridCells(pts, sc, k))
  return index
}

function computeGridCells(points: ProjectionMapPoint[], sc: ScalePair, k: number): Map<string, ProjectionMapPoint> {
  const best = new Map<string, { point: ProjectionMapPoint; dist2: number }>()
  for (const point of points) {
    const sx = sc.x(point.tsne_comp1) * k
    const sy = sc.y(point.tsne_comp2) * k
    const ci = Math.floor(sx / CELL_SIZE), cj = Math.floor(sy / CELL_SIZE)
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
  <svg className={styles.lassoIcon} viewBox="0 0 1024 1024" version="1.1" xmlns="http://www.w3.org/2000/svg">
    <path d="M70.582857 461.421714c0 196.717714 168.850286 307.291429 379.702857 307.291429 16.274286 0 33.005714-0.859429 49.718857-1.718857 17.554286 7.296 38.582857 11.574857 62.134858 11.574857 64.292571 0 129.426286-17.993143 187.282285-48.859429 1.28 6.436571 1.718857 13.293714 1.718857 20.150857 0 51.419429-29.147429 101.558857-77.147428 132.004572-12.434286 8.996571-21.430857 17.993143-21.430857 33.426286 0 15.853714 12.873143 29.568 33.005714 29.568 9.435429 0 14.994286-2.56 23.149714-7.716572 66.011429-42.861714 106.715429-114.432 106.715429-188.580571 0-19.712-2.56-38.125714-7.716572-55.698286 86.125714-65.572571 145.718857-162.011429 145.718858-267.867429 0-203.995429-181.723429-345.856-398.994286-345.856-237.860571 0-483.876571 155.995429-483.876572 382.281143z m64.713143 0.438857c0-186.861714 214.272-317.988571 419.565714-317.988571 179.565714 0 334.281143 111.414857 334.281143 280.685714 0 81.005714-45.421714 156.013714-111.433143 209.590857-35.986286-47.579429-94.281143-77.568-161.572571-77.568-98.139429 0-172.288 51.419429-172.288 127.268572 0 7.296 0.859429 14.153143 2.578286 20.571428C275.437714 702.281143 135.314286 621.714286 135.314286 461.860571zM509.001143 681.691429c0-35.986286 50.139429-59.995429 112.274286-59.995429 42.861714 0 79.725714 18.432 103.314285 48.420571-50.157714 27.867429-107.154286 44.141714-162.450285 44.141715-30.848 0-53.138286-11.995429-53.138286-32.548572z" />
  </svg>
)


// ─── Component ───────────────────────────────────────────────────────────────

export function ProjectionMapView({
  points, selectedScenes,
  onGlyphClick, onSelectionChange,
}: ProjectionMapViewProps) {
  
  const [showTrain, setShowTrain] = useState(true)
  const [showVal, setShowVal] = useState(true)
  const [lassoActive, setLassoActive] = useState(false)

  const svgRef          = useRef<SVGSVGElement | null>(null)
  const scatterGroupRef = useRef<SVGGElement | null>(null)
  const glyphGroupRef   = useRef<SVGGElement | null>(null)
  const lassoPathRef    = useRef<SVGPathElement | null>(null)
  const transformRef    = useRef(d3.zoomIdentity)
  const zoomRafRef      = useRef<number | null>(null)
  const zoomRef         = useRef<d3.ZoomBehavior<SVGSVGElement, unknown> | null>(null)
  const prevSnappedKRef = useRef<number | null>(null)

  // Always-current refs used inside event handlers and D3 callbacks.
  const lassoActiveRef        = useRef(lassoActive)
  const onGlyphClickRef       = useRef(onGlyphClick)
  const onSelectionChangeRef  = useRef(onSelectionChange)
  const scalesRef             = useRef<ScalePair | null>(null)
  const pointsRef             = useRef(points)
  useLayoutEffect(() => {
    lassoActiveRef.current       = lassoActive
    onGlyphClickRef.current      = onGlyphClick
    onSelectionChangeRef.current = onSelectionChange
    pointsRef.current            = points
  })

  // Lasso drawing state — managed imperatively to avoid re-renders during draw.
  const isDrawingRef  = useRef(false)
  const lassoDraftRef = useRef<Vec2[]>([])

  // Convex hull bubble path — set after each completed lasso.
  const [hullPath, setHullPath] = useState('')

  // ─── Viewport state ──────────────────────────────────────────────────────────

  const [viewport, setViewport] = useState<Viewport>({
    x0: -Infinity, x1: Infinity, y0: -Infinity, y1: Infinity,
    k: 1, tx: 0, ty: 0,
  })

  // ─── Scales ──────────────────────────────────────────────────────────────────

  const scales = useMemo<ScalePair>(() => {
    const xExt = d3.extent(points, p => p.tsne_comp1)
    const yExt = d3.extent(points, p => p.tsne_comp2)
    const sc: ScalePair = {
      x: d3.scaleLinear().domain([xExt[0] ?? -1, xExt[1] ?? 1]).nice().range([CHART_PADDING, VIEWBOX_WIDTH - CHART_PADDING]),
      y: d3.scaleLinear().domain([yExt[0] ?? -1, yExt[1] ?? 1]).nice().range([VIEWBOX_HEIGHT - CHART_PADDING, CHART_PADDING]),
    }
    scalesRef.current = sc
    return sc
  }, [points])

  // ─── Derived lists ───────────────────────────────────────────────────────────

  const valPoints   = useMemo(() => points.filter(p => p.split === 'val'),   [points])
  const trainPoints = useMemo(() => points.filter(p => p.split === 'train'), [points])

  const visibleGlyphPoints = useMemo(() => {
    if (showTrain && showVal) return points
    if (showTrain) return trainPoints
    if (showVal) return valPoints
    return []
  }, [showTrain, showVal, points, valPoints, trainPoints])

  // ─── Grid index ──────────────────────────────────────────────────────────────

  const gridIndex = useMemo(() => ({
    val:   buildGridIndex(valPoints,   scales),
    train: buildGridIndex(trainPoints, scales),
    all:   buildGridIndex(points,      scales),
  }), [points, scales, valPoints, trainPoints])

  const glyphsActive = viewport.k >= LOD_GLYPH_MIN_K
  const snappedK     = snapGridK(viewport.k)

  const gridCells = useMemo(() => {
    if (!glyphsActive) return new Map<string, ProjectionMapPoint>()
    const idx = (showTrain && showVal) ? gridIndex.all : showTrain ? gridIndex.train : showVal ? gridIndex.val : null
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
    const density = d3.contourDensity<ProjectionMapPoint>()
      .x(d => scales.x(d.tsne_comp1)).y(d => scales.y(d.tsne_comp2))
      .size([VIEWBOX_WIDTH, VIEWBOX_HEIGHT]).bandwidth(28).thresholds(18)
    return density(densityPoints)
  }, [densityPoints, scales])

  const densityGeoPath = useMemo(() => d3.geoPath(), [])

  const densityColor = useMemo(() => {
    if (!densityContours.length) return (_: number) => 'transparent'
    return d3.scaleSequential(d3.interpolateRgb('#f0f2f7', '#7b93b8'))
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

  const culledScatterPoints = useMemo(() => {
    const { x0, x1, y0, y1 } = viewport
    const base = glyphsActive ? [] : visibleGlyphPoints
    if (x0 === -Infinity) return base
    return base.filter(p => {
      const cx = scales.x(p.tsne_comp1), cy = scales.y(p.tsne_comp2)
      return cx >= x0 && cx <= x1 && cy >= y0 && cy <= y1
    })
  }, [glyphsActive, visibleGlyphPoints, scales, viewport])

  // ─── Selection set ───────────────────────────────────────────────────────────

  const selectedSet = useMemo(
    () => new Set(selectedScenes.map(s => s.scene_name)),
    [selectedScenes],
  )

  // ─── D3 glyph join ───────────────────────────────────────────────────────────

  useEffect(() => {
    if (!glyphGroupRef.current) return

    const { k, tx, ty } = viewport
    const half = MAP_GLYPH_SIZE / 2
    const toX  = (d: ProjectionMapPoint) => scales.x(d.tsne_comp1) * k + tx - half
    const toY  = (d: ProjectionMapPoint) => scales.y(d.tsne_comp2) * k + ty - half

    const isSnapChange = prevSnappedKRef.current !== null && prevSnappedKRef.current !== snappedK
    prevSnappedKRef.current = snappedK

    const joined = d3
      .select(glyphGroupRef.current)
      .selectAll<SVGImageElement, ProjectionMapPoint>('image')
      .data(culledGlyphPoints, d => d.scene_name)

    joined.exit().remove()

    joined
      .enter()
      .append('image')
      .attr('href',   d => `${GLYPH_BASE}${d.scene_name}.webp`)
      .attr('width',  MAP_GLYPH_SIZE)
      .attr('height', MAP_GLYPH_SIZE)
      .attr('x', toX).attr('y', toY)
      .attr('class', styles.glyphImage)
      .style('pointer-events', 'all')
      .on('click', (_event, d) => { onGlyphClickRef.current?.(d.scene_name) })
      .on('mouseenter', function () {
        d3.select(this).raise().attr('width', MAP_GLYPH_SIZE * 1.18).attr('height', MAP_GLYPH_SIZE * 1.18)
      })
      .on('mouseleave', function () {
        d3.select(this).attr('width', MAP_GLYPH_SIZE).attr('height', MAP_GLYPH_SIZE)
      })

    if (isSnapChange) {
      joined.interrupt('reposition').transition('reposition')
        .duration(REPOSITION_DURATION).ease(REPOSITION_EASE)
        .attr('x', toX).attr('y', toY)
    } else {
      joined.interrupt('reposition').attr('x', toX).attr('y', toY)
    }
  }, [culledGlyphPoints, snappedK, scales, viewport])

  // Keep selected-glyph class in sync with selectedSet.
  useEffect(() => {
    if (!glyphGroupRef.current) return
    d3.select(glyphGroupRef.current)
      .selectAll<SVGImageElement, ProjectionMapPoint>('image')
      .classed(styles.glyphImageSelected, d => selectedSet.has(d.scene_name))
  }, [selectedSet])

  // ─── Zoom setup ──────────────────────────────────────────────────────────────

  useEffect(() => {
    if (!svgRef.current) return
    const svg = d3.select(svgRef.current)

    const zoom = d3.zoom<SVGSVGElement, unknown>()
      .scaleExtent([1, 16])
      .translateExtent([[-VIEWBOX_WIDTH, -VIEWBOX_HEIGHT], [VIEWBOX_WIDTH * 2, VIEWBOX_HEIGHT * 2]])
      // In lasso mode: allow scroll-wheel zoom but block pointer-drag pan.
      .filter(event => lassoActiveRef.current ? event.type === 'wheel' : !event.button)
      .on('zoom', (event: d3.D3ZoomEvent<SVGSVGElement, unknown>) => {
        const t = event.transform
        transformRef.current = t
        scatterGroupRef.current?.setAttribute('transform', formatTransform(t))
        svgRef.current?.style.setProperty('--scatter-r', String(POINT_RADIUS / t.k))
        svgRef.current?.style.setProperty('--sel-r',     String(POINT_RADIUS * 0.52 / t.k))
        if (zoomRafRef.current !== null) cancelAnimationFrame(zoomRafRef.current)
        zoomRafRef.current = requestAnimationFrame(() => {
          zoomRafRef.current = null
          setViewport(computeViewport(transformRef.current))
        })
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
      lassoPathRef.current?.setAttribute('d', '')
    }
  }, [lassoActive])

  // Clear hull bubble when selection is cleared externally.
  useEffect(() => {
    if (selectedScenes.length === 0) setHullPath('')
  }, [selectedScenes])

  // ─── Lasso pointer handlers ───────────────────────────────────────────────────

  function handlePointerDown(e: React.PointerEvent<SVGSVGElement>) {
    if (!lassoActiveRef.current || e.button !== 0 || !svgRef.current) return
    // Interrupt any ongoing zoom-to-fit animation so the new lasso starts clean.
    d3.select(svgRef.current).interrupt()
    setHullPath('')
    e.currentTarget.setPointerCapture(e.pointerId)
    isDrawingRef.current = true
    lassoDraftRef.current = [toViewBox(svgRef.current, e.clientX, e.clientY)]
    lassoPathRef.current?.setAttribute('d', '')
  }

  function handlePointerMove(e: React.PointerEvent<SVGSVGElement>) {
    if (!isDrawingRef.current || !svgRef.current || !lassoPathRef.current) return
    lassoDraftRef.current.push(toViewBox(svgRef.current, e.clientX, e.clientY))
    lassoPathRef.current.setAttribute('d', polyToPathD(lassoDraftRef.current))
  }

  function handlePointerUp() {
    if (!isDrawingRef.current) return
    isDrawingRef.current = false
    lassoPathRef.current?.setAttribute('d', '')

    const poly = lassoDraftRef.current
    lassoDraftRef.current = []
    if (poly.length < 6) return  // too small — ignore accidental clicks

    const t  = transformRef.current
    const sc = scalesRef.current
    if (!sc) return

    const selected = pointsRef.current.filter(p => {
      const sx = sc.x(p.tsne_comp1) * t.k + t.x
      const sy = sc.y(p.tsne_comp2) * t.k + t.y
      return pointInPolygon(sx, sy, poly)
    })
    onSelectionChangeRef.current(selected)

    if (selected.length > 0) {
      // Show smooth convex hull bubble around the selected cluster (data-space).
      setHullPath(computeHullPath(selected, sc))

      // Animate zoom to fit the selected region.
      if (svgRef.current && zoomRef.current) {
        const target = computeFitTransform(selected, sc)
        d3.select(svgRef.current)
          .transition()
          .duration(680)
          .ease(d3.easeCubicInOut)
          .call(zoomRef.current.transform, target)
      }
    }
  }

  // ─── Render ──────────────────────────────────────────────────────────────────

  return (
    <section className={styles.panel}>

      <div className={styles.controlsOverlay}>
        <div className={styles.datasetToggles}>
          <button type="button" className={showVal ? styles.datasetActive : styles.datasetBtn} onClick={() => setShowVal(v => !v)}>val</button>
          <button type="button" className={showTrain ? styles.datasetActive : styles.datasetBtn} onClick={() => setShowTrain(v => !v)}>train</button>
        </div>
        <button type="button" className={lassoActive ? styles.lassoActive : styles.lassoBtn} onClick={() => setLassoActive(v => !v)} title="Lasso toggle">
          <LassoIcon />
        </button>
      </div>

      <svg
        ref={svgRef}
        className={styles.canvas}
        viewBox={`0 0 ${VIEWBOX_WIDTH} ${VIEWBOX_HEIGHT}`}
        style={{
          '--scatter-r': String(POINT_RADIUS),
          '--sel-r':     String(POINT_RADIUS * 0.52),
          cursor: lassoActive ? 'crosshair' : undefined,
        } as React.CSSProperties}
        role='img'
        aria-label='Training and validation scene projection view'
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
      >
        <rect className={styles.canvasBackground} width={VIEWBOX_WIDTH} height={VIEWBOX_HEIGHT} />

        <g ref={scatterGroupRef} className={styles.zoomLayer}>
          {/* Density heatmap — neutral gray-blue isocontours as background */}
          <g opacity={0.6}>
              {densityContours.map((contour, i) => (
                <path key={i} d={densityGeoPath(contour) ?? ''} fill={densityColor(contour.value)} stroke='none' />
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
            >
              <title>{`${point.scene_name} / ${point.split}`}</title>
            </circle>
          ))}

          {/* Convex hull bubble around the lasso-selected cluster (data-space) */}
          {hullPath && <path d={hullPath} className={styles.selectionBubble} />}

          {/* Selected scene dots — mutually exclusive with glyphs */}
          {!glyphsActive && selectedScenes.map(p => (
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
