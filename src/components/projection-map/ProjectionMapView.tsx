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
import { CategoryBarChart, type BarDatum } from '@/components/charts/CategoryBarChart'
import { glyphImageLoader, glyphImageUrl } from '@/lib/glyphImageLoader'
import type { ProjectionMapPoint, SplitName } from '@/types/scene'

const cls = {
  panel: 'relative min-h-0 flex-1 overflow-hidden bg-app-panel-bg-solid',
  canvas: 'block h-full w-full touch-none',
  canvasBackground: 'fill-app-panel-bg-solid',
  scatterDot: '[r:var(--scatter-r,4)]',
  selectedDot: 'pointer-events-none [r:var(--sel-r,2.08)]',
  zoomLayer: '[will-change:transform]',
  glyphLayer: 'pointer-events-none',
  lassoPath:
    'pointer-events-none [fill:color-mix(in_srgb,var(--color-accent)_10%,transparent)] [stroke:var(--color-accent)] [stroke-dasharray:6_3] [stroke-width:1.5px]',
  controlsOverlay: 'pointer-events-none absolute top-3 right-3 z-10 [&>*]:pointer-events-auto',
  lassoOverlay: 'pointer-events-none absolute top-3 left-3 z-10 [&>*]:pointer-events-auto',
  toolPill: 'flex gap-[3px] p-[3px]',
  toolBtnIdle:
    'flex cursor-pointer items-center justify-center rounded-[7px] border-none bg-transparent px-2 py-[5px] text-app-text-dim transition-colors hover:bg-app-row-hover hover:text-app-text-primary',
  toolBtnActive:
    'flex cursor-pointer items-center justify-center rounded-[7px] border-none px-2 py-[5px] text-accent transition-colors [background:color-mix(in_srgb,var(--color-accent)_12%,transparent)] hover:text-accent hover:[background:color-mix(in_srgb,var(--color-accent)_20%,transparent)]',
  lassoIcon: 'h-5 w-5 fill-current',
  glyphGroup: 'glyph cursor-pointer',
  glyphImage: 'transition-[filter] duration-[120ms] [image-rendering:pixelated]'
}

// Glyph selection/hover styling is applied imperatively from D3 (where both
// states are tracked) instead of via compound CSS descendant selectors. The
// combined filter composes both states deterministically.
const GLYPH_SELECTED_FILTER = "url('#glyph-selected-filter')"
const GLYPH_HOVER_FILTER = 'drop-shadow(0 3px 10px rgb(15 23 42 / 32%))'

function applyGlyphFilter(g: SVGGElement): void {
  const parts: string[] = []
  if (g.dataset.selected === 'true') parts.push(GLYPH_SELECTED_FILTER)
  if (g.dataset.hovered === 'true') parts.push(GLYPH_HOVER_FILTER)
  const img = g.querySelector('image')
  if (img) img.style.filter = parts.join(' ')
}

// ─── 类型定义 ─────────────────────────────────────────────────────────────────

type ProjectionMapViewProps = {
  points: ProjectionMapPoint[]
  selectedScenes: ProjectionMapPoint[]
  onGlyphClick?: (scene: ProjectionMapPoint) => void
  onSelectionChange?: (scenes: ProjectionMapPoint[]) => void
}

// 只存放缩放变换的三个参数（k 缩放比、tx/ty 平移量），
// 从 d3.ZoomTransform 中提取后写入 React state，驱动 LOD 切换和视口裁剪。
// x0/x1/y0/y1 等边界字段从不被读取，不纳入类型以避免冗余计算。
type Viewport = {
  k: number // 缩放系数，初始为 1
  tx: number // X 轴平移量（viewBox 单位）
  ty: number // Y 轴平移量（viewBox 单位）
}

type ScalePair = {
  x: d3.ScaleLinear<number, number>
  y: d3.ScaleLinear<number, number>
}

// ─── 全局常量 ─────────────────────────────────────────────────────────────────

// SVG viewBox 固定为逻辑分辨率，独立于屏幕物理像素。
// 所有坐标计算均在此空间内完成，CSS 负责将 SVG 拉伸到容器。
const VIEWBOX_WIDTH = 1280
const VIEWBOX_HEIGHT = 760

// 散点图四边留白，确保极端数据点不贴边
const CHART_PADDING = 18

// 散点半径（viewBox 单位），通过 CSS custom property --scatter-r 传入，
// 缩放时由 D3 在 zoom 回调里实时更新，保持屏幕上的物理半径恒定
const POINT_RADIUS = 2

// glyph 图片尺寸（像素）；CELL_SIZE 决定同一缩放级别下相邻 glyph 的最小间距
const MAP_GLYPH_SIZE = 50
const CELL_SIZE = 80

// matplotlib tab10 调色板的 C0/C1，学术图表标准色
const SPLIT_COLORS: Record<SplitName, string> = { train: '#1f77b4', val: '#d62728' }

// ─── Lasso 工具辅助函数 ──────────────────────────────────────────────────────

type Vec2 = [number, number]

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

/**
 * 射线法（Ray Casting）判断点是否在多边形内部。
 *
 * 原理：从测试点 (px, py) 向右发射一条水平射线，统计它与多边形各边的交叉次数。
 * 奇数次 → 点在内部；偶数次 → 点在外部。
 * 每次迭代检查多边形第 j→i 条边是否与射线相交：
 *   1. yi > py !== yj > py  确保边跨越 py 所在水平线（避免顶点被计算两次）
 *   2. 通过线段参数方程计算交点 x，若交点在测试点右侧则翻转 inside 标志
 */
function pointInPolygon(px: number, py: number, poly: Vec2[]): boolean {
  let inside = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i],
      [xj, yj] = poly[j]
    if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

/**
 * 将 Vec2 序列编码为 SVG path `d` 属性字符串（已闭合）。
 * 首点用 M（moveto），其余用 L（lineto），末尾加 Z 闭合路径。
 * 坐标保留 1 位小数，在视觉精度和字符串长度之间取得平衡。
 */
function polyToPathD(poly: Vec2[]): string {
  if (poly.length < 2) return ''
  return poly.map((v, i) => `${i ? 'L' : 'M'}${v[0].toFixed(1)},${v[1].toFixed(1)}`).join('') + 'Z'
}

// 框选完成后自动缩放时，在选中区域包围盒四周额外留白（viewBox 单位），
// 避免边缘 glyph 被切割
const FIT_PADDING = 72

/**
 * 计算将给定点集居中填充到视口的 ZoomTransform。
 *
 * 步骤：
 * 1. 将所有点投影到 screen 坐标，求包围盒 (x0,y0)-(x1,y1)
 * 2. 加上 FIT_PADDING 得到目标显示区域尺寸 (bw, bh)
 * 3. 选择能让区域完整显示的最小缩放系数 k（不超过最大缩放 8）
 * 4. 平移量 = 视口中心 - 数据中心 × k，使数据居中
 *
 * 返回值可直接传给 d3.zoom().transform() 驱动动画。
 */
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

// 将数据空间多边形重投影到当前 screen 空间，供 lasso 路径绘制和命中检测使用
function reprojectLasso(dataPoly: Vec2[], sc: ScalePair, t: d3.ZoomTransform): Vec2[] {
  return dataPoly.map(([dx, dy]): Vec2 => [sc.x(dx) * t.k + t.x, sc.y(dy) * t.k + t.y])
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

/**
 * 将连续的缩放系数 k 吸附到最近的离散 LOD 级别。
 *
 * 级别序列为 2^(n/4)（每隔 1/4 octave 一级），即相邻两级之比为 2^(1/4) ≈ 1.19。
 * 吸附公式：先取 log₂(k) × 4，四舍五入到整数，再还原 → 2^(round/4)
 *
 * 使用离散级别而非连续 k 的原因：
 * - 连续变化会导致每帧都重建 gridCells，带来大量 GC 压力
 * - 离散级别 + useMemo 依赖检测，只在跨越级别边界时重建一次
 */
function snapGridK(k: number): number {
  return Math.pow(2, Math.round(Math.log2(k) * 4) / 4)
}

// 预计算所有 LOD 级别对应的 snappedK 值（i 从 0 到 20，对应 k ≈ 0.063 ~ 32）。
// 在模块加载时一次性生成，buildGridIndex 遍历此列表为每个级别预构建网格索引。
const SNAP_LEVELS: readonly number[] = Array.from({ length: 21 }, (_, i) =>
  Math.pow(2, (i - 4) / 4)
)

// GridIndex：外层 Map 的键为 snappedK，内层 Map 的键为 "ci,cj" 网格坐标，值为该格的代表点
type GridIndex = Map<number, Map<string, ProjectionMapPoint>>

/**
 * 为给定点集在所有 LOD 级别上预构建网格索引。
 *
 * 为什么要预构建？
 * 缩放时 snappedK 会在离散级别间跳变，若每次跳变都重新遍历全部数据点会有延迟。
 * 预构建后切换级别只需 O(1) 的 Map.get()，代价是 O(levels × points) 的初始化开销，
 * 但 levels 固定为 21，属于可接受的一次性成本。
 */
function buildGridIndex(pts: ProjectionMapPoint[], sc: ScalePair): GridIndex {
  const index: GridIndex = new Map()
  for (const k of SNAP_LEVELS) index.set(k, computeGridCells(pts, sc, k))
  return index
}

/**
 * 在给定缩放级别 k 下，将点集划分到固定尺寸（CELL_SIZE）的网格，
 * 每格仅保留距格心最近的一个点，作为该格的"代表 glyph"。
 *
 * 核心逻辑：
 * 1. 将每个点映射到 scaled screen 空间（坐标 × k）
 * 2. 整除 CELL_SIZE 得到格子索引 (ci, cj)
 * 3. 计算点到格心的距离平方 d2
 * 4. 用 best Map 记录每格当前最近点，遍历完成后提取结果
 *
 * 效果：保证相邻 glyph 在屏幕上至少间隔 CELL_SIZE/k 个数据坐标单位，
 * 从而避免高密度区域的 glyph 重叠。
 */
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
//    由 D3 数据绑定管理 <image>，放在独立的 <g ref={glyphGroupRef}>，
//    每帧直接计算 screen 坐标写 translate，无需矩阵叠加。

export function ProjectionMapView({
  points,
  selectedScenes,
  onGlyphClick,
  onSelectionChange
}: ProjectionMapViewProps) {
  // 处于 scatter 模式的 split 集合；成员 = 始终显示散点，非成员 = 显示 glyph
  const [scatterSplits, setScatterSplits] = useState<Set<SplitName>>(new Set())

  // lasso 选框工具是否处于激活状态（影响指针事件路由和光标样式）
  const [lassoActive, setLassoActive] = useState(false)

  const activeIds = (['train', 'val'] as SplitName[]).filter(s => !scatterSplits.has(s))

  // ─── DOM 引用 ──────────────────────────────────────────────────────────────

  const svgRef = useRef<SVGSVGElement | null>(null) // 根 SVG，挂载 D3 zoom
  const scatterGroupRef = useRef<SVGGElement | null>(null) // 散点 <g>，接受 D3 transform
  const glyphGroupRef = useRef<SVGGElement | null>(null) // glyph <g>，screen-space 定位
  const lassoPathRef = useRef<SVGPathElement | null>(null) // lasso 选框路径，命令式更新
  const transformRef = useRef(d3.zoomIdentity) // 当前 ZoomTransform 的镜像 ref，
  // 供 D3 回调和事件处理器读取，
  // 无需等待 React 状态更新
  const zoomRafRef = useRef<number | null>(null) // 待执行的 rAF id，用于去抖
  const zoomRef = useRef<d3.ZoomBehavior<SVGSVGElement, unknown> | null>(null) // D3 zoom 实例
  const glyphLoadControllersRef = useRef(new Map<string, AbortController>())

  useEffect(
    () => () => {
      for (const controller of glyphLoadControllersRef.current.values()) controller.abort()
      glyphLoadControllersRef.current.clear()
    },
    []
  )

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

  const snappedK = snapGridK(viewport.k)

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
    const screenPoly = reprojectLasso(dp, sc, t)
    const selected = points.filter(p =>
      pointInPolygon(sc.x(p.tsne_comp1) * t.k + t.x, sc.y(p.tsne_comp2) * t.k + t.y, screenPoly)
    )
    onSelectionChangeRef.current?.(selected)
  }, [points])

  // ─── D3 glyph 数据绑定（enter / update / exit）──────────────────────────────
  //
  // 为什么 glyph 用 D3 而不用 React 渲染？
  // 缩放时 glyph 的 screen 坐标每帧都变，若通过 React 渲染，
  // 每帧需要 diff 并 commit 数百个 <g> 的 transform 属性，成本极高。
  // D3 在 zoom 回调里直接操作 DOM，完全绕过 React diff。
  //
  // 这个 effect 只处理 glyph 集合的增删（数据变化、split 切换、视口裁剪变化），
  // 不负责每帧的位置更新（那部分由 zoom 回调处理）。
  //
  // key 函数使用 scene_name 确保 D3 能复用已有 DOM 节点而非全量重建。

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
      .data<ProjectionMapPoint>(culledGlyphPoints, d => d.scene_name)

    // 移除视口外或已切换 LOD 的 glyph
    joined
      .exit()
      .each(d => {
        const sceneName = (d as ProjectionMapPoint).scene_name
        glyphLoadControllersRef.current.get(sceneName)?.abort()
        glyphLoadControllersRef.current.delete(sceneName)
      })
      .remove()

    const entered = joined
      .enter()
      .append('g')
      .attr('class', cls.glyphGroup)
      .attr('transform', toTranslate)
      .style('pointer-events', 'all')
      .on('click', (_event, d) => {
        onGlyphClickRef.current?.(d)
      })
      // raise() 将 hover 的 glyph 移到兄弟节点最后（SVG 画家算法），
      // 使其绘制在最顶层，避免被相邻 glyph 遮挡。
      //
      // 注意：d3.selection.raise() 本质上是 parentNode.appendChild(this)，
      // 即使元素已是最后子节点，appendChild 仍会先将其从 DOM 中移除再插回，
      // 产生真实 DOM 变异 → 浏览器重新触发 mouseleave（捕获丢失）→ 立即
      // 触发 mouseenter → 再次 raise() → 无限循环，导致 CSS transition 反复重置，
      // 视觉上表现为 glyph 频繁跳动。
      //
      // 修复：先检查是否已是最后子节点，仅在需要时才 raise()；
      // 同时改用 JS class（.glyphGroupHovered）取代 CSS :hover，
      // 因为 CSS :hover 依赖 DOM 位置状态，在 raise() 循环中同样不稳定。
      .on('mouseenter', function () {
        if (this.parentNode?.lastChild !== this) d3.select(this).raise()
        this.dataset.hovered = 'true'
        applyGlyphFilter(this)

        const center = MAP_GLYPH_SIZE / 2
        d3.select(this)
          .select('image')
          .interrupt()
          .transition()
          .duration(120)
          .attr(
            'transform',
            `translate(${center}, ${center}) scale(1.18) translate(-${center}, -${center})`
          )
      })
      .on('mouseleave', function () {
        this.dataset.hovered = 'false'
        applyGlyphFilter(this)

        d3.select(this)
          .select('image')
          .interrupt()
          .transition()
          .duration(120)
          .attr('transform', 'translate(0, 0) scale(1) translate(0, 0)')
      })

    const enteredImages = entered
      .append('image')
      .attr('width', MAP_GLYPH_SIZE)
      .attr('height', MAP_GLYPH_SIZE)
      .attr('transform', 'translate(0, 0) scale(1) translate(0, 0)')
      .attr('class', cls.glyphImage)
      .on('error', function () {
        // glyph 文件缺失时隐藏整个 <g>，让网格格子保持空白而非显示破损图标
        d3.select(this.parentNode as SVGGElement).attr('display', 'none')
      })

    enteredImages.each(function (d) {
      const image = d3.select(this)
      const group = this.parentNode as SVGGElement
      const controller = new AbortController()
      glyphLoadControllersRef.current.set(d.scene_name, controller)
      void glyphImageLoader
        .load(glyphImageUrl(d.scene_name), { signal: controller.signal })
        .then(
          objectUrl => {
            if (!image.node()?.isConnected) return
            image.attr('href', objectUrl)
          },
          () => {
            if (group.isConnected) d3.select(group).attr('display', 'none')
          }
        )
        .finally(() => {
          if (glyphLoadControllersRef.current.get(d.scene_name) === controller) {
            glyphLoadControllersRef.current.delete(d.scene_name)
          }
        })
    })

    // update 节点不加过渡动画：
    // zoom 回调每帧直接写 transform，若同时存在 D3 transition，
    // 两者会竞争同一属性，导致闪烁。interrupt() 终止残留过渡后直接写入。
    joined.interrupt().attr('transform', toTranslate)
  }, [culledGlyphPoints, snappedK, scales, viewport])

  // ─── 选中状态样式同步 ──────────────────────────────────────────────────────
  //
  // 选中状态变化频率远高于 glyph 集合变化（用户每次点击都可能改变），
  // 因此将其拆分为独立 effect，避免因 selectedSet 变化触发完整的 glyph join。
  // classed() 只修改 CSS class，不重建 DOM 节点，成本极低。
  // 注意额外依赖 culledGlyphPoints：当缩放产生新的可见节点 (enter) 时，必须重新应用选中状态。

  useEffect(() => {
    if (!glyphGroupRef.current) return
    d3.select(glyphGroupRef.current)
      .selectAll<SVGGElement, ProjectionMapPoint>('g.glyph')
      .each(function (d) {
        this.dataset.selected = selectedSet.has(d.scene_name) ? 'true' : 'false'
        applyGlyphFilter(this)
      })
  }, [selectedSet, culledGlyphPoints])

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
  //   - glyph 的 translate 属性
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

        // Glyph 逐个重算 screen 坐标并写入 transform，避免矩阵叠加误差
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

        const dp = lassoDataPolyRef.current
        if (dp.length > 0 && sc && lassoPathRef.current) {
          lassoPathRef.current.setAttribute('d', polyToPathD(reprojectLasso(dp, sc, t)))
        }

        // ── 条件触发 React 重渲染 ─────────────────────────────────────────────
        // snappedK 跨级时更新 React 状态；rAF 去抖合并快速缩放的重渲染。
        const prevSnap = snapGridK(prevT.k)
        const newSnap = snapGridK(t.k)
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
  }, [])

  // lasso 模式关闭时，重置所有绘制状态并清除 SVG 路径
  useEffect(() => {
    if (!lassoActive) {
      isDrawingRef.current = false
      lassoDraftRef.current = []
      clearLasso()
    }
  }, [lassoActive])

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

  function handlePointerDown(e: React.PointerEvent<SVGSVGElement>) {
    if (!lassoActiveRef.current || e.button !== 0 || !svgRef.current) return
    // 打断正在进行的 zoom-to-fit 动画，确保 lasso 从静止状态开始
    d3.select(svgRef.current).interrupt()
    clearLasso()
    // setPointerCapture 确保鼠标离开 SVG 区域后 pointermove/pointerup 仍能送达
    e.currentTarget.setPointerCapture(e.pointerId)
    isDrawingRef.current = true
    lassoDraftRef.current = [toViewBox(svgRef.current, e.clientX, e.clientY)]
  }

  function handlePointerMove(e: React.PointerEvent<SVGSVGElement>) {
    if (!isDrawingRef.current || !svgRef.current || !lassoPathRef.current) return
    lassoDraftRef.current.push(toViewBox(svgRef.current, e.clientX, e.clientY))
    lassoPathRef.current.setAttribute('d', polyToPathD(lassoDraftRef.current))
  }

  function handlePointerUp() {
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

  // ─── 渲染 ────────────────────────────────────────────────────────────────────
  //
  // SVG 层次结构：
  //
  //   <svg>                        ← 根，挂载 zoom 行为和 pointer 事件
  //     <defs>                     ← 选中滤镜定义（橙色叠加）
  //     <rect.canvasBackground>    ← 背景色块
  //     <g.zoomLayer>              ← 受 D3 transform 控制
  //       <g opacity=0.6>          ← 密度热图等值线
  //       circles.scatterDot       ← scatter 模式 split 的散点
  //       circles.selectedDot      ← scatter 模式下选中点高亮
  //     <g.glyphLayer>             ← screen-space glyph 层，D3 管理
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
          {/*
           * 选中 glyph 的蓝色叠加滤镜，步骤：
           * 1. feFlood：生成纯蓝色（#2563eb）30% 不透明度的色块
           * 2. feComposite in：用原图 alpha 通道裁剪色块，仅保留图像轮廓内的蓝色
           * 3. feComposite over：将裁剪后的蓝色叠加在原图之上
           * 效果：glyph 图片上叠加半透明蓝色遮罩，轮廓外透明（不影响周围）
           */}
          <filter id='glyph-selected-filter' colorInterpolationFilters='sRGB'>
            {/* 1. 生成高纯度蓝色 */}
            <feFlood floodColor='#f88f06' result='SOLID_COLOR' />
            {/* 2. 用原图 alpha 通道裁剪，绝不影响透明背景 */}
            <feComposite operator='in' in='SOLID_COLOR' in2='SourceAlpha' result='MASKED_COLOR' />
            {/* 3. 使用正片叠底 (multiply) 或颜色叠加，使图片纹理保留的同时改变颜色 */}
            <feBlend mode='multiply' in='MASKED_COLOR' in2='SourceGraphic' />
          </filter>
        </defs>
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

          {/* scatter 模式下的选中高亮；glyph 模式由 CSS 滤镜表达，无需重复渲染 */}
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

        {/* glyph 层：screen-space 定位，由 D3 数据绑定管理生命周期 */}
        <g ref={glyphGroupRef} className={cls.glyphLayer} />

        {/* lasso 路径：常驻 DOM，d 属性由 pointer 事件处理器命令式更新 */}
        <path ref={lassoPathRef} className={cls.lassoPath} />
      </svg>
    </section>
  )
}
