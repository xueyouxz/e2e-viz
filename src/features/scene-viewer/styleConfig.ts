import type { StyleConfig } from './types'

// ─── 目标类别颜色表 ──────────────────────────────────────────────────────────
//
// 按 NUSVIZ 协议 §11.1 的类别 ID 映射到视觉颜色和描边不透明度。
// 每种交通参与者使用固定色，确保跨帧、跨场景的视觉一致性。

type ObjectColorConfig = {
  color: string
  strokeOpacity: number
}

const OBJECT_CLASS_COLORS: Record<number, ObjectColorConfig> = {
  0: { color: '#6B7280', strokeOpacity: 0.8 }, // unknown（未知）
  1: { color: '#DC2626', strokeOpacity: 0.8 }, // barrier（隔离墩）
  2: { color: '#D97706', strokeOpacity: 0.8 }, // bicycle（自行车）
  3: { color: '#7C3AED', strokeOpacity: 0.8 }, // bus（公交）
  4: { color: '#4B8CF8', strokeOpacity: 0.8 }, // car（乘用车）
  5: { color: '#EA580C', strokeOpacity: 0.8 }, // construction_vehicle（工程车）
  6: { color: '#0D9488', strokeOpacity: 0.8 }, // motorcycle（摩托车）
  7: { color: '#16A34A', strokeOpacity: 0.8 }, // pedestrian（行人）
  8: { color: '#E11D48', strokeOpacity: 0.8 }, // traffic_cone（锥桶）
  9: { color: '#4F46E5', strokeOpacity: 0.8 }, // trailer（挂车）
  10: { color: '#0284C7', strokeOpacity: 0.8 } // truck（货车）
}

// 协议中未枚举的 classId 使用灰色兜底，strokeOpacity 略低以区分已知类别
const FALLBACK_COLOR: ObjectColorConfig = { color: '#9CA3AF', strokeOpacity: 0.64 }

export function getObjectColor(classId: number): ObjectColorConfig {
  return OBJECT_CLASS_COLORS[classId] ?? FALLBACK_COLOR
}

// ─── 流默认样式表 ────────────────────────────────────────────────────────────
//
// renderOrder 层级说明（数值越大越晚渲染，显示在上层）：
//   -20  底图图像（basemap）  ← 永远在最底层
//   -10  GT 地图多边形填充   ← 低于动态三维数据
//    0   点云（lidar）       ← 真实三维高度数据
//    1   预测地图折线        ← 高于底图/多边形
//    2   包围盒填充          ← 三维目标
//    5   轨迹/规划路径       ← 高于地图，低于包围盒边框
//   12   包围盒边框          ← CuboidLayer 在 renderOrder 上自动 +10

/**
 * 线性插值两个 hex 颜色，t ∈ [0, 1]。
 * 用于 planning 流按 L2 误差实时着色（0m 绿 → 3m 红）。
 */
function lerpColor(hexA: string, hexB: string, t: number): string {
  const ar = parseInt(hexA.slice(1, 3), 16)
  const ag = parseInt(hexA.slice(3, 5), 16)
  const ab = parseInt(hexA.slice(5, 7), 16)
  const br = parseInt(hexB.slice(1, 3), 16)
  const bg = parseInt(hexB.slice(3, 5), 16)
  const bb = parseInt(hexB.slice(5, 7), 16)
  const r = Math.round(ar + (br - ar) * t)
    .toString(16)
    .padStart(2, '0')
  const g = Math.round(ag + (bg - ag) * t)
    .toString(16)
    .padStart(2, '0')
  const b = Math.round(ab + (bb - ab) * t)
    .toString(16)
    .padStart(2, '0')
  return `#${r}${g}${b}`
}

// 按流路径配置的默认样式，getStyle() 在流名称匹配时返回对应配置，
// 未匹配时返回 {}（各渲染器自行使用内置默认值）
const defaultStyles: Record<string, StyleConfig> = {
  '/lidar': { color: '#ffffff', opacity: 0.8, renderOrder: 0 },

  '/gt/objects/bounds': { color: '#4b8cf8', opacity: 0.75, renderOrder: 2 },
  '/gt/objects/future_trajectories': {
    color: '#4b8cf8',
    opacity: 0.7,
    lineWidth: 0.3,
    renderOrder: 5
  },
  '/gt/ego/future_trajectory': { color: '#00e5ff', opacity: 0.9, lineWidth: 1, renderOrder: 5 },

  '/pred/sparsedrive/planning': {
    opacity: 0.9,
    lineWidth: 1,
    renderOrder: 5,
    // styleFn：运行时动态样式，根据当前帧的规划 L2 误差插值颜色
    // L2 误差 0m → 绿色（#00e676），3m → 红色（#ff1744），线性插值
    styleFn: ({ frameIndex, metrics }) => {
      const l2 = metrics?.['planning']?.[frameIndex]
      if (l2 == null) return { color: '#00e676' }
      const t = Math.max(0, Math.min(1, l2 / 3.0))
      return { color: lerpColor('#00e676', '#ff1744', t) }
    }
  },
  '/pred/sparsedrive/objects/bounds': { color: '#f8a94b', opacity: 0.35, renderOrder: 2 },
  '/pred/sparsedrive/map/divider': {
    color: '#ffcc00',
    opacity: 0.8,
    lineWidth: 0.1,
    renderOrder: 1
  },
  '/pred/sparsedrive/map/boundary': {
    color: '#ff7043',
    opacity: 0.8,
    lineWidth: 0.1,
    renderOrder: 1
  },
  '/pred/sparsedrive/map/ped_crossing': {
    color: '#ce93d8',
    opacity: 0.8,
    lineWidth: 0.1,
    renderOrder: 1
  },

  // GT 地图层：低不透明度 + 负 renderOrder，确保不遮挡动态三维数据
  '/gt/map/drivable_area': {
    color: '#ffffff',
    opacity: 0.25,
    outlineColor: '#c8d0d8',
    outlineWidth: 2.5,
    renderOrder: -10
  },
  '/gt/map/road_segment': { color: '#505ec9', opacity: 0.1, renderOrder: -10 },
  '/gt/map/lane': { color: '#7e8bdd', opacity: 0.1, renderOrder: -10 },
  '/gt/map/lane_connector': {
    color: '#8891d8',
    outlineColor: '#bdc3f5',
    opacity: 0.07,
    outlineWidth: 0.7,
    renderOrder: -10
  },
  '/gt/map/ped_crossing': { color: '#7986cb', opacity: 0.2, renderOrder: -10 },
  '/gt/map/walkway': { color: '#9fa8da', opacity: 0.1, renderOrder: -10 },
  '/gt/map/stop_line': { color: '#ef9a9a', opacity: 0.1, renderOrder: -10 },
  '/gt/map/carpark_area': { color: '#bcaaa4', opacity: 0.1, renderOrder: -10 },

  '/map/basemap': { opacity: 0.8, renderOrder: -20 }
}

/** 返回指定流的样式配置，未注册的流返回空对象（渲染器使用自身默认值） */
export function getStyle(streamName: string): StyleConfig {
  return defaultStyles[streamName] ?? {}
}

// ─── SVG / Canvas 调色板 ──────────────────────────────────────────────────────
//
// D3 图表工作在 SVG/Canvas 环境中，因此通过 JS 对象传递颜色值。

// SVG/Canvas 调色板：深色文字 + 浅色背景
export const svgTokens = {
  chart: {
    surface: '#eef0f6',
    chartBg: '#e6e8ee',
    frameStroke: '#4e5768',
    tickFill: '#616774',
    baseStroke: '#c9cdd6',
    zeroStroke: '#929ba8',
    speed: '#3a6fa3',
    accelerationPositive: '#497458',
    accelerationNegative: '#a05050',
    horizonBands: ['#eee2e2', '#dec5c5', '#cfa7a7', '#b88080', '#995c5c']
  }
} as const
