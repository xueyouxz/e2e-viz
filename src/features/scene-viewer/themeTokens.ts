import { createContext, useContext } from 'react'

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
    chartBg:      'rgb(255 255 255 / 4%)',
    frameStroke:  'rgb(255 255 255 / 50%)',
    labelFill:    'rgb(255 255 255 / 50%)',
    tickFill:     'rgb(255 255 255 / 36%)',
    baseStroke:   'rgb(255 255 255 / 22%)',
    zeroStroke:   'rgb(255 255 255 / 24%)',
    centerStroke: 'rgb(255 255 255 / 35%)',
    gtLabelFill:  'rgb(255 255 255 / 55%)',
    predLabelFill: 'rgb(255 255 255 / 40%)',
    collisionBg:  'rgb(12 12 16 / 80%)',
  },
  timeline: {
    background:       '#1a1a1a',
    padding:          14,
    trackHeight:      2,
    knobSize:         12,
    knobBorder:       '#5c5c5c',
    knobBorderActive: '#999',
    trackBg:          '#3d3d3d',
    trackFill:        '#2563eb',
    bufferFill:       'rgba(37,99,235,0.22)',
    tickMajorColor:   '#5c5c5c',
    tickMinorColor:   '#444',
    tickLabelColor:   '#7a7a7a',
    textPrimary:      '#ccc',
    textSecondary:    '#7a7a7a',
    btnColor:         '#7a7a7a',
    btnHoverColor:    '#ccc',
    borderColor:      '#333',
  },
}

export const LIGHT_TOKENS: ThemeTokens = {
  chart: {
    chartBg:      'rgb(0 0 0 / 3%)',
    frameStroke:  'rgb(0 0 0 / 45%)',
    labelFill:    'rgb(0 0 0 / 50%)',
    tickFill:     'rgb(0 0 0 / 40%)',
    baseStroke:   'rgb(0 0 0 / 18%)',
    zeroStroke:   'rgb(0 0 0 / 20%)',
    centerStroke: 'rgb(0 0 0 / 28%)',
    gtLabelFill:  'rgb(0 0 0 / 55%)',
    predLabelFill: 'rgb(0 0 0 / 40%)',
    collisionBg:  'rgb(240 242 250 / 80%)',
  },
  timeline: {
    background:       '#e8eaf0',
    padding:          14,
    trackHeight:      2,
    knobSize:         12,
    knobBorder:       '#8890a0',
    knobBorderActive: '#505868',
    trackBg:          '#b8bcc8',
    trackFill:        '#2563eb',
    bufferFill:       'rgba(37,99,235,0.22)',
    tickMajorColor:   '#9098a8',
    tickMinorColor:   '#c8ccd8',
    tickLabelColor:   '#7880a0',
    textPrimary:      '#282e40',
    textSecondary:    '#6870a0',
    btnColor:         '#7880a0',
    btnHoverColor:    '#282e40',
    borderColor:      '#c8cad4',
  },
}

export const ThemeTokensContext = createContext<ThemeTokens>(DARK_TOKENS)

export function useThemeTokens(): ThemeTokens {
  return useContext(ThemeTokensContext)
}
