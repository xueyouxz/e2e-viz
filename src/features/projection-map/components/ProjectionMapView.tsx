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
import { CategoryBarChart, type BarDatum } from './CategoryBarChart'
import { glyphAtlasLoader } from '../glyph/glyphAtlas'
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
  pointInPolygon,
  polygonPath,
  reprojectPolygon,
  snapGridScale
} from '../spatial'
import type { ScalePair, Vec2, Viewport } from '../spatial'
import type { ProjectionMapPoint, SplitName } from '../types'

const cls = {
  panel: 'relative min-h-0 flex-1 overflow-hidden bg-app-panel-bg-solid',
  canvas: 'block h-full w-full touch-none',
  canvasBackground: 'fill-app-panel-bg-solid',
  scatterDot: '[r:var(--scatter-r,4)]',
  selectedDot: 'pointer-events-none [r:var(--sel-r,2.08)]',
  zoomLayer: '[will-change:transform]',
  glyphLayer: 'pointer-events-none',
  glyphCanvas: 'block h-full w-full',
  lassoPath:
    'pointer-events-none [fill:color-mix(in_srgb,var(--color-accent)_10%,transparent)] [stroke:var(--color-accent)] [stroke-dasharray:6_3] [stroke-width:1.5px]',
  controlsOverlay: 'pointer-events-none absolute top-3 right-3 z-10 [&>*]:pointer-events-auto',
  lassoOverlay: 'pointer-events-none absolute top-3 left-3 z-10 [&>*]:pointer-events-auto',
  toolPill: 'flex gap-[3px] p-[3px]',
  toolBtnIdle:
    'flex cursor-pointer items-center justify-center rounded-[7px] border-none bg-transparent px-2 py-[5px] text-app-text-dim transition-colors hover:bg-app-row-hover hover:text-app-text-primary',
  toolBtnActive:
    'flex cursor-pointer items-center justify-center rounded-[7px] border-none px-2 py-[5px] text-accent transition-colors [background:color-mix(in_srgb,var(--color-accent)_12%,transparent)] hover:text-accent hover:[background:color-mix(in_srgb,var(--color-accent)_20%,transparent)]',
  lassoIcon: 'h-5 w-5 fill-current'
}

// ─── 类型定义 ─────────────────────────────────────────────────────────────────

type ProjectionMapViewProps = {
  points: ProjectionMapPoint[]
  selectedScenes: ProjectionMapPoint[]
  onGlyphClick?: (scene: ProjectionMapPoint) => void
  onSelectionChange?: (scenes: ProjectionMapPoint[]) => void
}

// ─── 全局常量 ─────────────────────────────────────────────────────────────────

// 散点图四边留白，确保极端数据点不贴边
const CHART_PADDING = 18

// 散点半径（viewBox 单位），通过 CSS custom property --scatter-r 传入，
// 缩放时由 D3 在 zoom 回调里实时更新，保持屏幕上的物理半径恒定
const POINT_RADIUS = 2

// glyph 图片尺寸（像素）
const MAP_GLYPH_SIZE = 50

// matplotlib tab10 调色板的 C0/C1，学术图表标准色
const SPLIT_COLORS: Record<SplitName, string> = { train: '#1f77b4', val: '#d62728' }

// ─── Lasso 工具辅助函数 ──────────────────────────────────────────────────────

/**
 * 将指针事件的 clientX/Y（屏幕坐标）转换为 SVG viewBox 坐标。
 *
 * SVG 通过 viewBox + preserveAspectRatio 将 1280×760 的逻辑空间映射到任意
 * 物理尺寸，因此不能直接用 clientX/Y 做碰撞检测。
 * 转换公式：逻辑坐标 = (指针偏移 / SVG 物理宽度) × viewBox 宽度
 */
function toViewBox(svg: SVGSVGElement, clientX: number, clientY: number): Vec2 {
  if (typeof DOMPoint !== 'undefined') {
    const pt = new DOMPoint(clientX, clientY)
    const ctm = svg.getScreenCTM()
    if (ctm) {
      const svgP = pt.matrixTransform(ctm.inverse())
      return [svgP.x, svgP.y]
    }
  }
  // Fallback (若无法获取 CTM)
  const r = svg.getBoundingClientRect()
  return [
    ((clientX - r.left) / r.width) * VIEWBOX_WIDTH,
    ((clientY - r.top) / r.height) * VIEWBOX_HEIGHT
  ]
}

// ─── Grid / LOD 辅助函数 ──────────────────────────────────────────────────────

// 将 ZoomTransform 格式化为 SVG transform 属性字符串，用于直接写入 DOM（非 React 渲染路径）
function formatTransform(t: d3.ZoomTransform): string {
  return `translate(${t.x} ${t.y}) scale(${t.k})`
}

// 从 ZoomTransform 提取 Viewport state 所需的三个字段
function computeViewport(t: d3.ZoomTransform): Viewport {
  return { k: t.k, tx: t.x, ty: t.y }
}

// Lasso 工具按钮图标，定义在组件外部避免每次渲染重新创建函数对象
const LassoIcon = () => (
  <svg
    className={cls.lassoIcon}
    viewBox='0 0 1024 1024'
    version='1.1'
    xmlns='http://www.w3.org/2000/svg'
  >
    <path d='M70.582857 461.421714c0 196.717714 168.850286 307.291429 379.702857 307.291429 16.274286 0 33.005714-0.859429 49.718857-1.718857 17.554286 7.296 38.582857 11.574857 62.134858 11.574857 64.292571 0 129.426286-17.993143 187.282285-48.859429 1.28 6.436571 1.718857 13.293714 1.718857 20.150857 0 51.419429-29.147429 101.558857-77.147428 132.004572-12.434286 8.996571-21.430857 17.993143-21.430857 33.426286 0 15.853714 12.873143 29.568 33.005714 29.568 9.435429 0 14.994286-2.56 23.149714-7.716572 66.011429-42.861714 106.715429-114.432 106.715429-188.580571 0-19.712-2.56-38.125714-7.716572-55.698286 86.125714-65.572571 145.718857-162.011429 145.718858-267.867429 0-203.995429-181.723429-345.856-398.994286-345.856-237.860571 0-483.876571 155.995429-483.876572 382.281143z m64.713143 0.438857c0-186.861714 214.272-317.988571 419.565714-317.988571 179.565714 0 334.281143 111.414857 334.281143 280.685714 0 81.005714-45.421714 156.013714-111.433143 209.590857-35.986286-47.579429-94.281143-77.568-161.572571-77.568-98.139429 0-172.288 51.419429-172.288 127.268572 0 7.296 0.859429 14.153143 2.578286 20.571428C275.437714 702.281143 135.314286 621.714286 135.314286 461.860571zM509.001143 681.691429c0-35.986286 50.139429-59.995429 112.274286-59.995429 42.861714 0 79.725714 18.432 103.314285 48.420571-50.157714 27.867429-107.154286 44.141714-162.450285 44.141715-30.848 0-53.138286-11.995429-53.138286-32.548572z' />
  </svg>
)

// ─── 组件 ──────────────────────────────────────────────────────────────────────
//
// 整体渲染架构：双轨制
//
// ① 散点层：仅渲染用户切换为 scatter 模式的 split（alwaysScatterPoints）。
//    由 React 渲染 <circle>，整组由 D3 直接写 transform，不触发 React 重渲染。
//
// ② Glyph 层：glyph 模式的 split 始终渲染为 glyph。
//    浏览器只加载一张 Atlas，Canvas 每帧按 scene 编号裁剪并绘制可见 glyph。

export function ProjectionMapView({
  points,
  selectedScenes,
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
  // 处于 scatter 模式的 split 集合；成员 = 始终显示散点，非成员 = 显示 glyph
  const [scatterSplits, setScatterSplits] = useState<Set<SplitName>>(new Set())

  // lasso 选框工具是否处于激活状态（影响指针事件路由和光标样式）
  const [lassoActive, setLassoActive] = useState(false)
  const [glyphAtlasStatus, setGlyphAtlasStatus] = useState<'loading' | 'ready' | 'error'>('loading')

  const activeIds = (['train', 'val'] as SplitName[]).filter(s => !scatterSplits.has(s))

  // ─── DOM 引用 ──────────────────────────────────────────────────────────────

  const svgRef = useRef<SVGSVGElement | null>(null) // 根 SVG，挂载 D3 zoom
  const scatterGroupRef = useRef<SVGGElement | null>(null) // 散点 <g>，接受 D3 transform
  const glyphCanvasRef = useRef<HTMLCanvasElement | null>(null) // 单张 Atlas 的 screen-space 绘制层
  const lassoPathRef = useRef<SVGPathElement | null>(null) // lasso 选框路径，命令式更新
  const transformRef = useRef(d3.zoomIdentity) // 当前 ZoomTransform 的镜像 ref，
  // 供 D3 回调和事件处理器读取，
  // 无需等待 React 状态更新
  const zoomRafRef = useRef<number | null>(null) // 待执行的 rAF id，用于去抖
  const zoomRef = useRef<d3.ZoomBehavior<SVGSVGElement, unknown> | null>(null) // D3 zoom 实例
  const glyphBitmapRef = useRef<ImageBitmap | null>(null)
  const glyphPointsRef = useRef<ProjectionMapPoint[]>([])
  const glyphScreenPointsRef = useRef<GlyphScreenPoint[]>([])
  const selectedSetRef = useRef<Set<string>>(new Set())
  const hoveredGlyphRef = useRef<string | null>(null)
  const pointerDownRef = useRef<Vec2 | null>(null)

  // ─── "永远最新" ref 模式 ─────────────────────────────────────────────────────
  //
  // D3 的 zoom 回调和 pointer 事件处理器在组件挂载时绑定一次，
  // 之后不会因 props/state 变化而重新绑定，形成闭包陷阱。
  //
  // 解决方案：用 ref 包裹这些值，事件处理器始终通过 .current 读取最新值。
  // 使用 useLayoutEffect（而非 useEffect）在浏览器 paint 之前同步更新，
  // 避免事件处理器在同一帧内读到旧值。
  const lassoActiveRef = useRef(lassoActive)
  const onGlyphClickRef = useRef(onGlyphClick)
  const onSelectionChangeRef = useRef(onSelectionChange)
  const scalesRef = useRef<ScalePair | null>(null)
  const pointsRef = useRef(points)

  const redrawGlyphCanvas = useCallback(
    (transform = transformRef.current): void => {
      const canvas = glyphCanvasRef.current
      const context = canvas?.getContext('2d')
      if (!canvas || !context) return

      context.setTransform(1, 0, 0, 1, 0, 0)
      context.clearRect(0, 0, canvas.width, canvas.height)

      const atlas = glyphBitmapRef.current
      const scales = scalesRef.current
      if (!atlas || !scales) {
        glyphScreenPointsRef.current = []
        return
      }

      const screenPoints = glyphPointsRef.current.map<GlyphScreenPoint>(point => ({
        sceneName: point.scene_name,
        x: scales.x(point.tsne_comp1) * transform.k + transform.x,
        y: scales.y(point.tsne_comp2) * transform.k + transform.y,
        selected: selectedSetRef.current.has(point.scene_name)
      }))
      glyphScreenPointsRef.current = screenPoints

      context.setTransform(glyphCanvasPixelRatio, 0, 0, glyphCanvasPixelRatio, 0, 0)
      drawGlyphCanvas(context, atlas, screenPoints, {
        width: VIEWBOX_WIDTH,
        height: VIEWBOX_HEIGHT,
        glyphSize: MAP_GLYPH_SIZE,
        hoveredSceneName: hoveredGlyphRef.current
      })
    },
    [glyphCanvasPixelRatio]
  )

  useLayoutEffect(() => {
    lassoActiveRef.current = lassoActive
    onGlyphClickRef.current = onGlyphClick
    onSelectionChangeRef.current = onSelectionChange
    pointsRef.current = points
    scalesRef.current = scales
  })

  // ─── Lasso 绘制状态（命令式，避免绘制过程触发 React 重渲染）──────────────

  const isDrawingRef = useRef(false) // 当前是否正在绘制 lasso
  const lassoDraftRef = useRef<Vec2[]>([]) // 绘制中的 viewBox 坐标点序列
  // lasso 完成后将多边形从 screen 空间转换到数据空间存储，
  // 之后每次缩放/平移时重新投影回 screen 空间，实现 lasso 框跟随视图
  const lassoDataPolyRef = useRef<Vec2[]>([])

  // ─── Viewport 状态 ──────────────────────────────────────────────────────────
  //
  // viewport 不跟踪每一帧（那会导致 ~60 次/秒的 React 重渲染）。
  // 仅在 snappedK 跨越离散级别边界（需要重建 gridCells）或 zoom 结束时触发。
  // 平移和未跨级的缩放完全通过命令式 DOM 更新处理。

  const [viewport, setViewport] = useState<Viewport>({ k: 1, tx: 0, ty: 0 })

  // ─── D3 线性比例尺 ──────────────────────────────────────────────────────────
  //
  // Y 轴 range 反转（底→顶），使 t-SNE Y 轴正方向向上，符合数学习惯。

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
        .range([VIEWBOX_HEIGHT - CHART_PADDING, CHART_PADDING]) // Y 轴翻转
    }
    return sc
  }, [points])

  // ─── 派生点集 ───────────────────────────────────────────────────────────────

  // 按 split 预先分组，避免在多个下游 memo 里重复 filter
  const valPoints = useMemo(() => points.filter(p => p.split === 'val'), [points])
  const trainPoints = useMemo(() => points.filter(p => p.split === 'train'), [points])

  const alwaysScatterPoints = useMemo(
    () => points.filter(p => scatterSplits.has(p.split)),
    [points, scatterSplits]
  )

  // ─── 网格索引（LOD 预计算）──────────────────────────────────────────────────
  //
  // 在 points 或 scales 变化时一次性为 train/val 两个集合、
  // 21 个 LOD 级别各建一张网格 Map，共 42 张表。
  // 收益：缩放期间 gridCells 的刷新从 O(n) 降为 O(1)。

  const gridIndex = useMemo(
    () => ({
      val: buildGridIndex(valPoints, scales),
      train: buildGridIndex(trainPoints, scales)
    }),
    [valPoints, trainPoints, scales]
  )

  const snappedK = snapGridScale(viewport.k)

  // 合并所有 glyph 模式 split 在当前 LOD 的网格格子；same cell 先写先得
  const gridCells = useMemo(() => {
    const cells = new Map<string, ProjectionMapPoint>()
    for (const split of ['train', 'val'] as SplitName[]) {
      if (scatterSplits.has(split)) continue
      for (const [key, point] of gridIndex[split].get(snappedK) ?? []) {
        if (!cells.has(key)) cells.set(key, point)
      }
    }
    return cells
  }, [scatterSplits, gridIndex, snappedK])

  const densityContours = useMemo(() => {
    if (!points.length) return []
    const density = d3
      .contourDensity<ProjectionMapPoint>()
      .x(d => scales.x(d.tsne_comp1))
      .y(d => scales.y(d.tsne_comp2))
      .size([VIEWBOX_WIDTH, VIEWBOX_HEIGHT])
      .bandwidth(28)
      .thresholds(18)
    return density(points)
  }, [points, scales])

  const densityGeoPath = useRef(d3.geoPath())

  const densityColor = useMemo(() => {
    if (!densityContours.length) return (_: number) => 'transparent'
    return d3
      .scaleSequential(d3.interpolateRgb('#f0f2f7', '#2f67bb'))
      .domain([0, densityContours[densityContours.length - 1].value])
  }, [densityContours])

  // ─── 视口裁剪（Culling）────────────────────────────────────────────────────
  //
  // Glyph 层在 screen 空间定位，浏览器不会自动裁剪 viewBox 外的元素，
  // 未裁剪时 DOM 中可能存在数百个不可见 <g>，拖慢 layout 和事件命中测试。
  // 因此手动过滤：只保留 screen 坐标落在视口内（含半个 glyph 的边缘余量）的点。

  const culledGlyphPoints = useMemo(() => {
    const half = MAP_GLYPH_SIZE / 2
    const { k, tx, ty } = viewport
    return [...gridCells.values()].filter(p => {
      const sx = scales.x(p.tsne_comp1) * k + tx
      const sy = scales.y(p.tsne_comp2) * k + ty
      return sx >= -half && sx <= VIEWBOX_WIDTH + half && sy >= -half && sy <= VIEWBOX_HEIGHT + half
    })
  }, [gridCells, scales, viewport])

  const culledScatterPoints = alwaysScatterPoints

  // ─── 选中集合 ───────────────────────────────────────────────────────────────
  //
  // 将 selectedScenes 数组转为 Set，将后续的"是否选中"判断从 O(n) 降为 O(1)。
  // 在 glyph D3 join 的 classed() 调用和散点的 className 中使用。

  const selectedSet = useMemo(
    () => new Set(selectedScenes.map(s => s.scene_name)),
    [selectedScenes]
  )

  useLayoutEffect(() => {
    glyphPointsRef.current = culledGlyphPoints
    selectedSetRef.current = selectedSet
    redrawGlyphCanvas()
  }, [culledGlyphPoints, redrawGlyphCanvas, selectedSet, scales])

  useEffect(() => {
    let mounted = true
    void glyphAtlasLoader.load().then(
      bitmap => {
        if (!mounted) return
        glyphBitmapRef.current = bitmap
        setGlyphAtlasStatus('ready')
        redrawGlyphCanvas()
      },
      error => {
        if (!mounted) return
        setGlyphAtlasStatus('error')
        console.error('Glyph atlas load failed', error)
      }
    )

    return () => {
      mounted = false
      glyphBitmapRef.current = null
      glyphScreenPointsRef.current = []
    }
  }, [redrawGlyphCanvas])

  // ─── 柱状图数据 ─────────────────────────────────────────────────────────────

  // 单次遍历同时统计两个 split 的选中数量，避免两次 filter
  const splitSelectedCounts = useMemo(() => {
    const counts = { train: 0, val: 0 }
    for (const s of selectedScenes) {
      if (s.split === 'train') counts.train++
      else counts.val++
    }
    return counts
  }, [selectedScenes])

  const chartBars = useMemo<BarDatum[]>(
    () => [
      {
        id: 'train',
        label: 'Train',
        color: SPLIT_COLORS.train,
        total: trainPoints.length,
        selected: splitSelectedCounts.train
      },
      {
        id: 'val',
        label: 'Val',
        color: SPLIT_COLORS.val,
        total: valPoints.length,
        selected: splitSelectedCounts.val
      }
    ],
    [trainPoints.length, valPoints.length, splitSelectedCounts]
  )

  // 点击切换：glyph（跟随 LOD）↔ scatter（始终显示散点）
  // startTransition 将更新标记为低优先级，使 React 先响应交互，再批量提交派生计算
  const handleBarClick = useCallback((id: string) => {
    startTransition(() => {
      setScatterSplits(prev => {
        const next = new Set(prev)
        if (next.has(id as SplitName)) next.delete(id as SplitName)
        else next.add(id as SplitName)
        return next
      })
    })
  }, [])

  // ─── Split 切换时重新评估 lasso 选区 ────────────────────────────────────────
  //
  // 当用户重新打开某个 split 时，visibleGlyphPoints 变化触发此 effect。
  // 若当前存在 lasso 多边形（lassoDataPolyRef 非空），则将数据空间多边形
  // 重新投影到当前 screen 空间，筛选出新可见点中落在 lasso 内的点，
  // 并立即更新选中集合，确保柱状图反映正确比例。

  useEffect(() => {
    const dp = lassoDataPolyRef.current
    if (dp.length === 0) return
    const t = transformRef.current
    const sc = scalesRef.current
    if (!sc) return
    const screenPoly = reprojectPolygon(dp, sc, t)
    const selected = points.filter(p =>
      pointInPolygon(sc.x(p.tsne_comp1) * t.k + t.x, sc.y(p.tsne_comp2) * t.k + t.y, screenPoly)
    )
    onSelectionChangeRef.current?.(selected)
  }, [points])

  // ─── D3 缩放行为初始化 ──────────────────────────────────────────────────────
  //
  // 仅在挂载时执行一次（deps = []），zoom 实例存入 zoomRef 供后续使用。
  //
  // 事件过滤策略：
  // - lasso 模式下只允许滚轮缩放，屏蔽拖拽平移（避免与 lasso 绘制冲突）
  // - 非 lasso 模式下，过滤掉非主键（button !== 0）的指针事件
  //
  // zoom 回调的性能优化核心：
  // 每帧（~60fps）触发的操作全部走命令式 DOM 路径：
  //   - 散点组的 transform 属性
  //   - --scatter-r / --sel-r CSS 变量（维持散点屏幕尺寸恒定）
  //   - glyph Canvas 的一次重绘
  //   - lasso 路径的重投影
  // React setViewport 只在 LOD 模式切换或 snappedK 跨级时才调用，
  // 并通过 requestAnimationFrame 去抖，将多次快速缩放的重渲染合并为一次。

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
      .filter(event => (lassoActiveRef.current ? event.type === 'wheel' : !event.button))
      .on('zoom', (event: d3.D3ZoomEvent<SVGSVGElement, unknown>) => {
        const prevT = transformRef.current
        const t = event.transform
        transformRef.current = t

        // ── 命令式 DOM 更新（每帧，不触发 React 重渲染）──────────────────────

        // 散点整组一次性变换，比每个 <circle> 单独变换高效得多
        scatterGroupRef.current?.setAttribute('transform', formatTransform(t))

        // 散点半径随缩放反向补偿：radius_screen = POINT_RADIUS / k
        // 使用 CSS 自定义属性统一控制，CSS 里 r: var(--scatter-r) 生效
        svgRef.current?.style.setProperty('--scatter-r', String(POINT_RADIUS / t.k))
        svgRef.current?.style.setProperty('--sel-r', String((POINT_RADIUS * 0.52) / t.k))

        // Glyph 使用单张 Atlas 重绘，不创建或更新独立图片 DOM 节点
        const sc = scalesRef.current
        redrawGlyphCanvas(t)

        const dp = lassoDataPolyRef.current
        if (dp.length > 0 && sc && lassoPathRef.current) {
          lassoPathRef.current.setAttribute('d', polygonPath(reprojectPolygon(dp, sc, t)))
        }

        // ── 条件触发 React 重渲染 ─────────────────────────────────────────────
        // snappedK 跨级时更新 React 状态；rAF 去抖合并快速缩放的重渲染。
        const prevSnap = snapGridScale(prevT.k)
        const newSnap = snapGridScale(t.k)
        if (newSnap !== prevSnap) {
          if (zoomRafRef.current !== null) cancelAnimationFrame(zoomRafRef.current)
          zoomRafRef.current = requestAnimationFrame(() => {
            zoomRafRef.current = null
            setViewport(computeViewport(transformRef.current))
          })
        }
      })
      .on('end', () => {
        // 手势结束时强制同步一次最终 viewport，修正平移结束后的裁剪偏差。
        // 若有待执行的 rAF 则先取消，以最终位置为准。
        if (zoomRafRef.current !== null) {
          cancelAnimationFrame(zoomRafRef.current)
          zoomRafRef.current = null
        }
        setViewport(computeViewport(transformRef.current))
      })

    zoomRef.current = zoom
    svg.call(zoom)

    // 卸载时清理 D3 事件监听器和待执行 rAF，防止内存泄漏
    return () => {
      svg.on('.zoom', null)
      if (zoomRafRef.current !== null) cancelAnimationFrame(zoomRafRef.current)
    }
  }, [redrawGlyphCanvas])

  // lasso 模式关闭时，重置所有绘制状态并清除 SVG 路径
  useEffect(() => {
    if (lassoActive) {
      hoveredGlyphRef.current = null
      redrawGlyphCanvas()
    } else {
      isDrawingRef.current = false
      lassoDraftRef.current = []
      clearLasso()
    }
  }, [lassoActive, redrawGlyphCanvas])

  // 外部清除选中（selectedScenes 变为空数组）时同步清除 lasso 可视路径
  useEffect(() => {
    if (selectedScenes.length === 0) clearLasso()
  }, [selectedScenes])

  // ─── Lasso 指针事件处理器 ────────────────────────────────────────────────────
  //
  // 这三个处理器绑定在 SVG 根元素上，通过 React 合成事件系统接收。
  // 内部逻辑完全命令式（读写 ref），不触发任何 setState，
  // 绘制过程（pointerdown → pointermove × n → pointerup）零重渲染。

  function clearLasso() {
    lassoDataPolyRef.current = []
    lassoPathRef.current?.setAttribute('d', '')
  }

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
    clearLasso()
    // setPointerCapture 确保鼠标离开 SVG 区域后 pointermove/pointerup 仍能送达
    e.currentTarget.setPointerCapture(e.pointerId)
    isDrawingRef.current = true
    lassoDraftRef.current = [toViewBox(svgRef.current, e.clientX, e.clientY)]
  }

  function handlePointerMove(e: React.PointerEvent<SVGSVGElement>) {
    if (!lassoActiveRef.current) {
      if (!svgRef.current || e.buttons !== 0) {
        updateHoveredGlyph(null)
        return
      }
      const [x, y] = toViewBox(svgRef.current, e.clientX, e.clientY)
      updateHoveredGlyph(
        hitTestGlyph(glyphScreenPointsRef.current, x, y, MAP_GLYPH_SIZE, hoveredGlyphRef.current)
          ?.sceneName ?? null
      )
      return
    }
    if (!isDrawingRef.current || !svgRef.current || !lassoPathRef.current) return
    lassoDraftRef.current.push(toViewBox(svgRef.current, e.clientX, e.clientY))
    lassoPathRef.current.setAttribute('d', polygonPath(lassoDraftRef.current))
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
        glyphScreenPointsRef.current,
        x,
        y,
        MAP_GLYPH_SIZE,
        hoveredGlyphRef.current
      )
      const scene = hit ? pointsRef.current.find(point => point.scene_name === hit.sceneName) : null
      if (scene) onGlyphClickRef.current?.(scene)
      return
    }
    if (!isDrawingRef.current) return
    isDrawingRef.current = false

    const poly = lassoDraftRef.current
    lassoDraftRef.current = []

    // 少于 6 个点（3 个坐标对）无法构成有意义的多边形，视为误触
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

    // 用射线法测试每个可见点是否落在 lasso 多边形内。
    // 此时 poly 为 screen 空间坐标，点的 screen 坐标 = data坐标 * k + t
    const selected = pointsRef.current.filter(p => {
      const sx = sc.x(p.tsne_comp1) * t.k + t.x
      const sy = sc.y(p.tsne_comp2) * t.k + t.y
      return pointInPolygon(sx, sy, poly)
    })
    onSelectionChangeRef.current?.(selected)

    if (selected.length > 0) {
      // 将 screen 空间多边形逆变换回数据空间：
      // data_x = scale.x.invert((screen_x - tx) / k)
      // 存储数据空间多边形后，后续每次 zoom 事件重新正向投影，
      // 使 lasso 轮廓始终与数据点保持对应关系
      lassoDataPolyRef.current = poly.map(
        ([sx, sy]): Vec2 => [sc.x.invert((sx - t.x) / t.k), sc.y.invert((sy - t.y) / t.k)]
      )
      // 框选结束后动画过渡到最佳视角，让用户聚焦于选中的场景集群
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
  //       <g opacity=0.6>          ← 密度热图等值线
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
          >
            <LassoIcon />
          </button>
        </div>
      </div>

      {/* 右上角：train/val 分布柱状图，点击可切换 split 可见性 */}
      <div className={cls.controlsOverlay}>
        <div className={cls.toolPill}>
          <CategoryBarChart bars={chartBars} activeIds={activeIds} onBarClick={handleBarClick} />
        </div>
      </div>

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
        onPointerCancel={handlePointerLeave}
        onPointerLeave={handlePointerLeave}
      >
        <rect className={cls.canvasBackground} width={VIEWBOX_WIDTH} height={VIEWBOX_HEIGHT} />

        {/*
         * zoomLayer：受 D3 ZoomTransform 控制。
         * 密度热图和散点放在此组内，随缩放平移整体变换，
         * 无需对每个子元素单独计算 screen 坐标。
         */}
        <g ref={scatterGroupRef} className={cls.zoomLayer}>
          <g opacity={0.8}>
            {densityContours.map((contour, i) => (
              <path
                key={i}
                d={densityGeoPath.current(contour) ?? ''}
                fill={densityColor(contour.value)}
                stroke='none'
              />
            ))}
          </g>

          {culledScatterPoints.map(point => (
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
            [...gridCells.values()].map(point => (
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
          {selectedScenes
            .filter(p => scatterSplits.has(p.split))
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

        {/* glyph 层：单张 Atlas 在 Canvas 中按 screen-space 坐标裁剪绘制。 */}
        <foreignObject
          className={cls.glyphLayer}
          x={0}
          y={0}
          width={VIEWBOX_WIDTH}
          height={VIEWBOX_HEIGHT}
        >
          <canvas
            ref={glyphCanvasRef}
            className={cls.glyphCanvas}
            width={VIEWBOX_WIDTH * glyphCanvasPixelRatio}
            height={VIEWBOX_HEIGHT * glyphCanvasPixelRatio}
            aria-hidden='true'
          />
        </foreignObject>

        {/* lasso 路径：常驻 DOM，d 属性由 pointer 事件处理器命令式更新 */}
        <path ref={lassoPathRef} className={cls.lassoPath} />
      </svg>
    </section>
  )
}
