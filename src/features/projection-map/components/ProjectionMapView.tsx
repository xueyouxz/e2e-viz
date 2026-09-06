import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import * as d3 from 'd3'
import { Lasso } from 'lucide-react'
import { SPLIT_COLORS } from '../splitConfig'
import { glyphAtlasLoader } from '../glyph/glyphAtlas'
import { useGlyphAtlas } from '../glyph/useGlyphAtlas'
import { resolveGlyphLayout, ZOOM_EXTENT } from '../glyph/glyphLayout'
import { useLassoSelection } from '../useLassoSelection'
import {
  drawGlyphCanvas,
  hitTestGlyph,
  resolveGlyphCanvasPixelRatio,
  type GlyphScreenPoint
} from '../glyph/glyphCanvasRenderer'
import {
  VIEWBOX_HEIGHT,
  VIEWBOX_WIDTH,
  buildGridIndex,
  computeFitTransform,
  queryVisibleGridPoints,
  toViewBox,
  viewBoxBounds
} from '../spatial'
import type { GridIndex, ScalePair, Vec2 } from '../spatial'
import type { ProjectionMapPoint, SplitName, SplitMode } from '../types'

const cls = {
  panel: 'relative min-h-0 min-w-0 flex-1 overflow-hidden bg-app-panel-bg-solid',
  canvas: 'block h-full w-full touch-none',
  canvasBackground: 'fill-app-panel-bg-solid',
  scatterDot: '[r:var(--scatter-r,4)]',
  selectedDot: 'pointer-events-none [r:var(--sel-r,2.08)]',
  zoomLayer: '[will-change:transform]',
  glyphLayer: 'pointer-events-none',
  glyphCanvas: 'block h-full w-full',
  lassoPath:
    'pointer-events-none [fill:color-mix(in_srgb,var(--color-accent)_10%,transparent)] [stroke:var(--color-accent)] [stroke-dasharray:6_3] [stroke-width:1.5px]',
  lassoOverlay: 'pointer-events-none absolute top-3 left-3 z-10 [&>*]:pointer-events-auto',
  toolPill: 'flex gap-[3px] p-[3px]',
  toolBtnIdle:
    'flex cursor-pointer items-center justify-center rounded-[7px] border-none bg-transparent px-2 py-[5px] text-app-text-dim transition-colors hover:bg-app-row-hover hover:text-app-text-primary',
  toolBtnActive:
    'flex cursor-pointer items-center justify-center rounded-[7px] border-none px-2 py-[5px] text-accent transition-colors [background:color-mix(in_srgb,var(--color-accent)_12%,transparent)] hover:text-accent hover:[background:color-mix(in_srgb,var(--color-accent)_20%,transparent)]',
  lassoIcon: 'h-5 w-5'
}

// ─── 类型定义 ─────────────────────────────────────────────────────────────────

export type ProjectionViewRequest = {
  points: ProjectionMapPoint[]
  requestId: number
}

type ProjectionMapViewProps = {
  points: ProjectionMapPoint[]
  allPoints: ProjectionMapPoint[]
  selectedScenes: ProjectionMapPoint[]
  highlightedScenes: ProjectionMapPoint[]
  splitModes: Record<SplitName, SplitMode>
  viewRequest: ProjectionViewRequest | null
  onGlyphClick?: (scene: ProjectionMapPoint) => void
  onSelectionChange?: (scenes: ProjectionMapPoint[]) => void
}

// ─── 全局常量 ─────────────────────────────────────────────────────────────────

// 散点图四边留白，确保极端数据点不贴边
const CHART_PADDING = 18

// 散点半径（viewBox 单位），通过 CSS custom property --scatter-r 传入，
// 缩放时由 D3 在 zoom 回调里实时更新，保持屏幕上的物理半径恒定
const POINT_RADIUS = 2

// D3 owns the viewport transform; Canvas redraws are coalesced per animation frame.
export function ProjectionMapView({
  points,
  allPoints,
  selectedScenes,
  highlightedScenes,
  splitModes,
  viewRequest,
  onGlyphClick,
  onSelectionChange
}: ProjectionMapViewProps) {
  const glyphCanvasPixelRatio = useMemo(
    () =>
      resolveGlyphCanvasPixelRatio(
        typeof window === 'undefined' ? undefined : window.devicePixelRatio
      ),
    []
  )

  // lasso 选框工具是否处于激活状态（影响指针事件路由和光标样式）
  const [lassoActive, setLassoActive] = useState(false)
  const { status: glyphAtlasStatus, bitmap: glyphBitmap } = useGlyphAtlas()
  const [glyphBounds, setGlyphBounds] = useState(() => viewBoxBounds(VIEWBOX_WIDTH, VIEWBOX_HEIGHT))

  // ─── DOM 引用 ──────────────────────────────────────────────────────────────

  const svgRef = useRef<SVGSVGElement | null>(null) // 根 SVG，挂载 D3 zoom
  const scatterGroupRef = useRef<SVGGElement | null>(null) // 散点 <g>，接受 D3 transform
  const glyphCanvasRef = useRef<HTMLCanvasElement | null>(null) // 单张 Atlas 的 screen-space 绘制层
  const transformRef = useRef(d3.zoomIdentity) // 当前 ZoomTransform 的镜像 ref，
  // 供 D3 回调和事件处理器读取，
  // 无需等待 React 状态更新
  const glyphDrawRafRef = useRef<number | null>(null) // 合并同一帧内的多次 zoom 重绘
  const zoomRef = useRef<d3.ZoomBehavior<SVGSVGElement, unknown> | null>(null) // D3 zoom 实例
  const glyphBitmapRef = useRef<ImageBitmap | null>(null)
  const glyphIndexesRef = useRef<readonly GridIndex[]>([])
  const pinnedGlyphPointsRef = useRef<readonly { sceneName: string; x: number; y: number }[]>([])
  const glyphFrameRef = useRef({ points: [] as GlyphScreenPoint[], layout: resolveGlyphLayout(1) })
  const selectedSetRef = useRef<Set<string>>(new Set())
  const hoveredGlyphRef = useRef<string | null>(null)
  const pointerDownRef = useRef<Vec2 | null>(null)

  const lassoActiveRef = useRef(lassoActive)

  useLayoutEffect(() => {
    const svg = svgRef.current
    if (!svg) return
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect
      if (width <= 0 || height <= 0) return
      setGlyphBounds(viewBoxBounds(width, height))
    })
    observer.observe(svg)
    return () => observer.disconnect()
  }, [])

  const redrawGlyphCanvas = useCallback(
    (transform = transformRef.current): void => {
      const canvas = glyphCanvasRef.current
      const context = canvas?.getContext('2d')
      if (!canvas || !context) return

      const atlas = glyphBitmapRef.current
      const scaleX = canvas.width / glyphBounds.width
      const scaleY = canvas.height / glyphBounds.height
      context.setTransform(scaleX, 0, 0, scaleY, -glyphBounds.x * scaleX, -glyphBounds.y * scaleY)
      if (!atlas) {
        context.clearRect(glyphBounds.x, glyphBounds.y, glyphBounds.width, glyphBounds.height)
        glyphFrameRef.current.points = []
        return
      }

      const layout = resolveGlyphLayout(transform.k)
      const visiblePoints = queryVisibleGridPoints(
        glyphIndexesRef.current,
        { k: transform.k, tx: transform.x, ty: transform.y },
        glyphBounds,
        layout
      )
      const screenPointsByName = new Map<string, GlyphScreenPoint>()
      for (const { point, x, y } of visiblePoints) {
        screenPointsByName.set(point.scene_name, {
          sceneName: point.scene_name,
          x: x * transform.k + transform.x,
          y: y * transform.k + transform.y,
          selected: selectedSetRef.current.has(point.scene_name)
        })
      }
      const halfGlyph = layout.glyphSize / 2
      for (const point of pinnedGlyphPointsRef.current) {
        const x = point.x * transform.k + transform.x
        const y = point.y * transform.k + transform.y
        if (
          x < glyphBounds.x - halfGlyph ||
          x > glyphBounds.x + glyphBounds.width + halfGlyph ||
          y < glyphBounds.y - halfGlyph ||
          y > glyphBounds.y + glyphBounds.height + halfGlyph
        ) {
          continue
        }
        // Reinsert marked glyphs last so they survive LOD sampling and draw above neighbours.
        screenPointsByName.delete(point.sceneName)
        screenPointsByName.set(point.sceneName, {
          sceneName: point.sceneName,
          x,
          y,
          selected: true
        })
      }
      const screenPoints = [...screenPointsByName.values()]
      glyphFrameRef.current = { points: screenPoints, layout }

      drawGlyphCanvas(context, atlas, screenPoints, {
        bounds: glyphBounds,
        glyphSize: layout.glyphSize,
        hoveredSceneName: hoveredGlyphRef.current
      })
    },
    [glyphBounds]
  )

  const scheduleGlyphCanvasRedraw = useCallback(() => {
    if (glyphDrawRafRef.current !== null) return
    glyphDrawRafRef.current = requestAnimationFrame(() => {
      glyphDrawRafRef.current = null
      redrawGlyphCanvas(transformRef.current)
    })
  }, [redrawGlyphCanvas])

  const scales = useMemo<ScalePair>(() => {
    const xExt = d3.extent(allPoints, p => p.tsne_comp1)
    const yExt = d3.extent(allPoints, p => p.tsne_comp2)
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
        .range([VIEWBOX_HEIGHT - CHART_PADDING, CHART_PADDING]) // Y 轴翻转
    }
    return sc
  }, [allPoints])

  // ─── 派生点集 ───────────────────────────────────────────────────────────────

  // 按 split 预先分组，避免在多个下游 memo 里重复 filter
  const valPoints = useMemo(() => points.filter(p => p.split === 'val'), [points])
  const trainPoints = useMemo(() => points.filter(p => p.split === 'train'), [points])

  const alwaysScatterPoints = useMemo(
    () => points.filter(p => splitModes[p.split] === 'scatter'),
    [points, splitModes]
  )

  // ─── 网格索引（LOD 预计算）──────────────────────────────────────────────────
  //
  // 在 points 或 scales 变化时一次性为 train/val 两个集合、
  // 为各个 LOD 档位预建网格。
  // 缩放热路径只查询视口覆盖的网格单元，不扫描整个点集。

  const gridIndex = useMemo(
    () => ({
      val: buildGridIndex(valPoints, scales),
      train: buildGridIndex(trainPoints, scales)
    }),
    [valPoints, trainPoints, scales]
  )

  // Each cell compares candidates across both glyph-mode splits.
  const activeGlyphIndexes = useMemo(
    () =>
      (['train', 'val'] as SplitName[])
        .filter(split => splitModes[split] === 'glyph')
        .map(split => gridIndex[split]),
    [gridIndex, splitModes]
  )

  // Until the atlas is ready, show all points of the affected splits as dots.
  const fallbackGlyphPoints = useMemo(
    () => points.filter(point => splitModes[point.split] === 'glyph'),
    [points, splitModes]
  )

  // Filtering changes visible glyphs, while density and coordinates use the full dataset.
  const densityContours = useMemo(() => {
    if (!allPoints.length) return []
    return d3
      .contourDensity<ProjectionMapPoint>()
      .x(d => scales.x(d.tsne_comp1))
      .y(d => scales.y(d.tsne_comp2))
      .size([VIEWBOX_WIDTH, VIEWBOX_HEIGHT])
      .bandwidth(28)
      .thresholds(18)(allPoints)
  }, [allPoints, scales])

  const densityGeoPath = useRef(d3.geoPath())

  const densityColor = useMemo(() => {
    if (!densityContours.length) return (_: number) => 'transparent'
    return d3
      .scaleSequential(d3.interpolateRgb('#f0f2f7', '#2f67bb'))
      .domain([0, densityContours[densityContours.length - 1].value])
  }, [densityContours])

  // ─── 选中集合 ───────────────────────────────────────────────────────────────
  //
  // Lasso selection and explicit highlights share the same Canvas selection border.

  const markedScenes = useMemo(() => {
    const scenesByName = new Map<string, ProjectionMapPoint>()
    for (const scene of selectedScenes) scenesByName.set(scene.scene_name, scene)
    for (const scene of highlightedScenes) scenesByName.set(scene.scene_name, scene)
    return [...scenesByName.values()]
  }, [highlightedScenes, selectedScenes])
  const selectedSet = useMemo(
    () => new Set(markedScenes.map(scene => scene.scene_name)),
    [markedScenes]
  )
  const pinnedGlyphPoints = useMemo(
    () =>
      markedScenes
        .filter(scene => splitModes[scene.split] === 'glyph')
        .map(scene => ({
          sceneName: scene.scene_name,
          x: scales.x(scene.tsne_comp1),
          y: scales.y(scene.tsne_comp2)
        })),
    [markedScenes, scales, splitModes]
  )

  useLayoutEffect(() => {
    glyphBitmapRef.current = glyphBitmap
    glyphIndexesRef.current = activeGlyphIndexes
    pinnedGlyphPointsRef.current = pinnedGlyphPoints
    selectedSetRef.current = selectedSet
    redrawGlyphCanvas()
  }, [activeGlyphIndexes, glyphBitmap, pinnedGlyphPoints, redrawGlyphCanvas, selectedSet])

  const lasso = useLassoSelection({
    svgRef,
    transformRef,
    scales,
    points,
    enabled: lassoActive,
    hasSelection: selectedScenes.length > 0,
    onSelectionChange
  })
  const { drawingRef, redraw: redrawLasso } = lasso

  useLayoutEffect(() => {
    lassoActiveRef.current = lassoActive
    if (lassoActive) hoveredGlyphRef.current = null
    redrawGlyphCanvas()
  }, [lassoActive, redrawGlyphCanvas])

  useEffect(() => {
    if (!svgRef.current) return
    const svg = d3.select(svgRef.current)

    const zoom = d3
      .zoom<SVGSVGElement, unknown>()
      .scaleExtent(ZOOM_EXTENT)
      .translateExtent([
        [-VIEWBOX_WIDTH, -VIEWBOX_HEIGHT],
        [VIEWBOX_WIDTH * 2, VIEWBOX_HEIGHT * 2]
      ])
      .filter(
        event =>
          !drawingRef.current && (lassoActiveRef.current ? event.type === 'wheel' : !event.button)
      )
      .on('zoom', (event: d3.D3ZoomEvent<SVGSVGElement, unknown>) => {
        const t = event.transform
        transformRef.current = t

        // ── 命令式 DOM 更新（每帧，不触发 React 重渲染）──────────────────────

        // 散点整组一次性变换，比每个 <circle> 单独变换高效得多
        scatterGroupRef.current?.setAttribute('transform', t.toString())

        // 散点半径随缩放反向补偿：radius_screen = POINT_RADIUS / k
        // 使用 CSS 自定义属性统一控制，CSS 里 r: var(--scatter-r) 生效
        svgRef.current?.style.setProperty('--scatter-r', String(POINT_RADIUS / t.k))
        svgRef.current?.style.setProperty('--sel-r', String((POINT_RADIUS * 0.52) / t.k))

        scheduleGlyphCanvasRedraw()
        redrawLasso()
      })

    zoomRef.current = zoom
    svg.call(zoom)

    // 卸载时清理 D3 事件监听器和待执行 Canvas 帧，防止内存泄漏
    return () => {
      svg.interrupt().on('.zoom', null)
      if (glyphDrawRafRef.current !== null) {
        cancelAnimationFrame(glyphDrawRafRef.current)
        glyphDrawRafRef.current = null
      }
    }
  }, [scheduleGlyphCanvasRedraw, drawingRef, redrawLasso])

  useEffect(() => {
    if (!viewRequest?.points.length || !svgRef.current || !zoomRef.current) return
    d3.select(svgRef.current)
      .interrupt()
      .transition()
      .duration(520)
      .ease(d3.easeCubicInOut)
      .call(zoomRef.current.transform, computeFitTransform(viewRequest.points, scales))
  }, [scales, viewRequest])

  function updateHoveredGlyph(sceneName: string | null): void {
    if (hoveredGlyphRef.current === sceneName) return
    hoveredGlyphRef.current = sceneName
    if (svgRef.current) svgRef.current.style.cursor = sceneName ? 'pointer' : 'grab'
    redrawGlyphCanvas()
  }

  function handlePointerDown(e: React.PointerEvent<SVGSVGElement>) {
    if (e.button !== 0 || !svgRef.current) return
    if (!lassoActiveRef.current) {
      pointerDownRef.current = [e.clientX, e.clientY]
      return
    }
    // 打断正在进行的 zoom-to-fit 动画，确保 lasso 从静止状态开始
    d3.select(svgRef.current).interrupt()
    lasso.start(e)
  }

  function handlePointerMove(e: React.PointerEvent<SVGSVGElement>) {
    if (!lassoActiveRef.current) {
      if (!svgRef.current || e.buttons !== 0) {
        updateHoveredGlyph(null)
        return
      }
      const [x, y] = toViewBox(svgRef.current, e.clientX, e.clientY)
      updateHoveredGlyph(
        hitTestGlyph(
          glyphFrameRef.current.points,
          x,
          y,
          glyphFrameRef.current.layout.glyphSize,
          hoveredGlyphRef.current
        )?.sceneName ?? null
      )
      return
    }
    lasso.move(e)
  }

  function handlePointerUp(e: React.PointerEvent<SVGSVGElement>) {
    if (!lassoActiveRef.current) {
      const start = pointerDownRef.current
      pointerDownRef.current = null
      if (!start || !svgRef.current || Math.hypot(e.clientX - start[0], e.clientY - start[1]) > 5) {
        return
      }
      const [x, y] = toViewBox(svgRef.current, e.clientX, e.clientY)
      const hit = hitTestGlyph(
        glyphFrameRef.current.points,
        x,
        y,
        glyphFrameRef.current.layout.glyphSize,
        hoveredGlyphRef.current
      )
      const scene = hit ? points.find(point => point.scene_name === hit.sceneName) : null
      if (scene) onGlyphClick?.(scene)
      return
    }
    const selected = lasso.finish(e)
    if (selected?.length && svgRef.current && zoomRef.current) {
      d3.select(svgRef.current)
        .transition()
        .duration(680)
        .ease(d3.easeCubicInOut)
        .call(zoomRef.current.transform, computeFitTransform(selected, scales))
    }
  }

  function handlePointerLeave() {
    pointerDownRef.current = null
    if (!lassoActiveRef.current) updateHoveredGlyph(null)
  }

  // ─── 渲染 ────────────────────────────────────────────────────────────────────
  //
  // SVG 层次结构：
  //
  //   <svg>                        ← 根，挂载 zoom 行为和 pointer 事件
  //     <rect.canvasBackground>    ← 背景色块
  //     <g.zoomLayer>              ← 受 D3 transform 控制
  //       <g>                     ← 全量密度等值线，不随筛选改变
  //       circles.scatterDot       ← scatter 模式 split 的散点
  //       circles.selectedDot      ← scatter 模式下选中点高亮
  //     <foreignObject><canvas>    ← screen-space Atlas glyph 层
  //     <path.lassoPath>           ← lasso 轮廓，命令式更新

  return (
    <section className={cls.panel}>
      {/* 左上角：lasso 工具切换按钮 */}
      <div className={cls.lassoOverlay}>
        <div className={cls.toolPill}>
          <button
            type='button'
            className={lassoActive ? cls.toolBtnActive : cls.toolBtnIdle}
            onClick={() => setLassoActive(v => !v)}
            title='Lasso select'
            aria-label='Lasso select'
            aria-pressed={lassoActive}
          >
            <Lasso className={cls.lassoIcon} strokeWidth={1.6} aria-hidden='true' />
          </button>
        </div>
      </div>

      {glyphAtlasStatus === 'error' && (
        <button
          type='button'
          className='absolute bottom-3 left-3 z-10 rounded border border-app-border bg-app-surface px-3 py-1 text-sm text-app-text'
          onClick={() => {
            void glyphAtlasLoader.load().catch(() => {})
          }}
        >
          Retry glyph loading
        </button>
      )}

      <svg
        ref={svgRef}
        className={cls.canvas}
        viewBox={`0 0 ${VIEWBOX_WIDTH} ${VIEWBOX_HEIGHT}`}
        style={
          {
            // 初始散点半径通过 CSS 变量注入，缩放时由 zoom 回调实时更新
            '--scatter-r': String(POINT_RADIUS),
            '--sel-r': String(POINT_RADIUS * 0.52),
            cursor: lassoActive ? 'crosshair' : 'grab'
          } as React.CSSProperties
        }
        role='img'
        aria-label='Training and validation scene projection view'
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={() => {
          pointerDownRef.current = null
          lasso.cancel()
        }}
        onLostPointerCapture={() => {
          if (drawingRef.current) lasso.cancel()
        }}
        onPointerLeave={handlePointerLeave}
      >
        <rect className={cls.canvasBackground} width={VIEWBOX_WIDTH} height={VIEWBOX_HEIGHT} />

        {/*
         * zoomLayer：受 D3 ZoomTransform 控制。
         * 密度热图和散点放在此组内，随缩放平移整体变换，
         * 无需对每个子元素单独计算 screen 坐标。
         */}
        <g ref={scatterGroupRef} className={cls.zoomLayer}>
          <g opacity={0.8} pointerEvents='none' role='group' aria-label='All scenes density'>
            {densityContours.map((contour, i) => (
              <path
                key={i}
                d={densityGeoPath.current(contour) ?? ''}
                fill={densityColor(contour.value)}
                stroke='none'
              />
            ))}
          </g>

          {alwaysScatterPoints.map(point => (
            <circle
              key={point.scene_name}
              className={cls.scatterDot}
              cx={scales.x(point.tsne_comp1)}
              cy={scales.y(point.tsne_comp2)}
              fill={SPLIT_COLORS[point.split]}
              opacity={0.55}
            />
          ))}

          {/* Atlas 加载失败时保留空间结构，不退回到逐图请求。 */}
          {glyphAtlasStatus !== 'ready' &&
            fallbackGlyphPoints.map(point => (
              <circle
                key={'glyph-placeholder-' + point.scene_name}
                className={cls.scatterDot}
                cx={scales.x(point.tsne_comp1)}
                cy={scales.y(point.tsne_comp2)}
                fill={SPLIT_COLORS[point.split]}
                opacity={glyphAtlasStatus === 'error' ? 0.45 : 0.25}
              />
            ))}

          {/* scatter 模式下的选中高亮；glyph 模式由 Canvas 描边表达。 */}
          {markedScenes
            .filter(p => splitModes[p.split] === 'scatter')
            .map(p => (
              <circle
                key={`sel-${p.scene_name}`}
                className={cls.selectedDot}
                cx={scales.x(p.tsne_comp1)}
                cy={scales.y(p.tsne_comp2)}
                fill={SPLIT_COLORS[p.split]}
              />
            ))}
        </g>

        {/* Cover the SVG viewport including letterboxing; retain viewBox coordinates for picking. */}
        <foreignObject
          className={cls.glyphLayer}
          x={glyphBounds.x}
          y={glyphBounds.y}
          width={glyphBounds.width}
          height={glyphBounds.height}
        >
          <canvas
            ref={glyphCanvasRef}
            className={cls.glyphCanvas}
            width={Math.ceil(glyphBounds.width * glyphCanvasPixelRatio)}
            height={Math.ceil(glyphBounds.height * glyphCanvasPixelRatio)}
            aria-hidden='true'
          />
        </foreignObject>

        {/* lasso 路径：常驻 DOM，d 属性由 pointer 事件处理器命令式更新 */}
        <path ref={lasso.pathRef} className={cls.lassoPath} />
      </svg>
    </section>
  )
}
