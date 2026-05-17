import { createContext, useContext, useMemo } from 'react'
import type { ReactNode } from 'react'
import { useTheme } from '@/app/themeContext'
import type { StyleConfig } from './types'

// ─── Object class colors ───────────────────────────────────────────────────────
// Maps NUSVIZ class IDs (protocol §11.1) to visual color and stroke opacity.

interface ObjectColorConfig {
  color: string
  strokeOpacity: number
}

const OBJECT_CLASS_COLORS: Record<number, ObjectColorConfig> = {
  0: { color: '#6B7280', strokeOpacity: 0.8 }, // unknown
  1: { color: '#DC2626', strokeOpacity: 0.8 }, // barrier
  2: { color: '#D97706', strokeOpacity: 0.8 }, // bicycle
  3: { color: '#7C3AED', strokeOpacity: 0.8 }, // bus
  4: { color: '#4B8CF8', strokeOpacity: 0.8 }, // car
  5: { color: '#EA580C', strokeOpacity: 0.8 }, // construction_vehicle
  6: { color: '#0D9488', strokeOpacity: 0.8 }, // motorcycle
  7: { color: '#16A34A', strokeOpacity: 0.8 }, // pedestrian
  8: { color: '#E11D48', strokeOpacity: 0.8 }, // traffic_cone
  9: { color: '#4F46E5', strokeOpacity: 0.8 }, // trailer
  10: { color: '#0284C7', strokeOpacity: 0.8 } // truck
}

const FALLBACK_COLOR: ObjectColorConfig = { color: '#9CA3AF', strokeOpacity: 0.64 }

export function getObjectColor(classId: number): ObjectColorConfig {
  return OBJECT_CLASS_COLORS[classId] ?? FALLBACK_COLOR
}

// ─── Stream default styles ─────────────────────────────────────────────────────
// Render order hierarchy (higher = renders later / appears on top):
//   -20  basemap image          (always below everything)
//   -10  gt map polygon fills   (below dynamic 3D data)
//    0   point cloud            (lidar, real 3D heights)
//    1   pred map polylines     (above basemap/polygons)
//    2   cuboid fills           (3D objects)
//    5   trajectories / paths   (above map, below cuboid edges)
//   12   cuboid edges           (CuboidRenderer adds +10 automatically)

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
    .padStart(2, '00')
  const b = Math.round(ab + (bb - ab) * t)
    .toString(16)
    .padStart(2, '0')
  return `#${r}${g}${b}`
}

export const defaultStyles: Record<string, StyleConfig> = {
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
    // planning L2 error 0 m → green, 3 m → red, linear interpolation
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

export function getStyle(streamName: string): StyleConfig {
  return defaultStyles[streamName] ?? {}
}

// ─── SVG / canvas theme tokens ─────────────────────────────────────────────────
// Used by D3 charts and PlaybackTimeline, which cannot consume CSS variables.

export interface SvgPalette {
  chartBg: string
  frameStroke: string
  labelFill: string
  tickFill: string
  baseStroke: string
  zeroStroke: string
  centerStroke: string
  gtLabelFill: string
  predLabelFill: string
  collisionBg: string
}

export interface TimelineTokens {
  background: string
  padding: number | { left?: number; right?: number }
  trackHeight: number
  knobSize: number
  knobBorder: string
  knobBorderActive: string
  trackBg: string
  trackFill: string
  bufferFill: string
  tickMajorColor: string
  tickMinorColor: string
  tickLabelColor: string
  textPrimary: string
  textSecondary: string
  btnColor: string
  btnHoverColor: string
  borderColor: string
}

export interface ThemeTokens {
  chart: SvgPalette
  timeline: TimelineTokens
}

export const DARK_TOKENS: ThemeTokens = {
  chart: {
    chartBg: 'rgb(255 255 255 / 4%)',
    frameStroke: 'rgb(255 255 255 / 50%)',
    labelFill: 'rgb(255 255 255 / 50%)',
    tickFill: 'rgb(255 255 255 / 36%)',
    baseStroke: 'rgb(255 255 255 / 22%)',
    zeroStroke: 'rgb(255 255 255 / 24%)',
    centerStroke: 'rgb(255 255 255 / 35%)',
    gtLabelFill: 'rgb(255 255 255 / 55%)',
    predLabelFill: 'rgb(255 255 255 / 40%)',
    collisionBg: 'rgb(12 12 16 / 80%)'
  },
  timeline: {
    background: '#1a1a1a',
    padding: 14,
    trackHeight: 2,
    knobSize: 12,
    knobBorder: '#5c5c5c',
    knobBorderActive: '#999',
    trackBg: '#3d3d3d',
    trackFill: '#2563eb',
    bufferFill: 'rgba(37,99,235,0.22)',
    tickMajorColor: '#5c5c5c',
    tickMinorColor: '#444',
    tickLabelColor: '#7a7a7a',
    textPrimary: '#ccc',
    textSecondary: '#7a7a7a',
    btnColor: '#7a7a7a',
    btnHoverColor: '#ccc',
    borderColor: '#333'
  }
}

export const LIGHT_TOKENS: ThemeTokens = {
  chart: {
    chartBg: 'rgb(0 0 0 / 3%)',
    frameStroke: 'rgb(0 0 0 / 45%)',
    labelFill: 'rgb(0 0 0 / 50%)',
    tickFill: 'rgb(0 0 0 / 40%)',
    baseStroke: 'rgb(0 0 0 / 18%)',
    zeroStroke: 'rgb(0 0 0 / 20%)',
    centerStroke: 'rgb(0 0 0 / 28%)',
    gtLabelFill: 'rgb(0 0 0 / 55%)',
    predLabelFill: 'rgb(0 0 0 / 40%)',
    collisionBg: 'rgb(240 242 250 / 80%)'
  },
  timeline: {
    background: '#e8eaf0',
    padding: 14,
    trackHeight: 2,
    knobSize: 12,
    knobBorder: '#8890a0',
    knobBorderActive: '#505868',
    trackBg: '#b8bcc8',
    trackFill: '#2563eb',
    bufferFill: 'rgba(37,99,235,0.22)',
    tickMajorColor: '#9098a8',
    tickMinorColor: '#c8ccd8',
    tickLabelColor: '#7880a0',
    textPrimary: '#282e40',
    textSecondary: '#6870a0',
    btnColor: '#7880a0',
    btnHoverColor: '#282e40',
    borderColor: '#c8cad4'
  }
}

export const ThemeTokensContext = createContext<ThemeTokens>(DARK_TOKENS)

export function useThemeTokens(): ThemeTokens {
  return useContext(ThemeTokensContext)
}

export function ThemeTokensProvider({ children }: { children: ReactNode }) {
  const { theme } = useTheme()
  const tokens = useMemo(() => (theme === 'dark' ? DARK_TOKENS : LIGHT_TOKENS), [theme])
  return <ThemeTokensContext.Provider value={tokens}>{children}</ThemeTokensContext.Provider>
}
