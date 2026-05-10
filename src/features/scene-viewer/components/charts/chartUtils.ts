import type { MouseEvent } from 'react'
import { scaleLinear } from 'd3'
import type { SceneStore } from '../../store/sceneStore'

export const SVG_W = 276
export const ML = 24
export const MR = 8
export const PLOT_W = SVG_W - ML - MR

export function arrayMax(arr: Float32Array | null): number {
  if (!arr || arr.length === 0) return 1
  let max = 0
  for (let i = 0; i < arr.length; i++) if (arr[i] > max) max = arr[i]
  return max || 1
}

export function arrayMin(arr: Float32Array | null): number {
  if (!arr || arr.length === 0) return 0
  let min = Infinity
  for (let i = 0; i < arr.length; i++) if (arr[i] < min) min = arr[i]
  return isFinite(min) ? min : 0
}

export function makeXInvert(frameCount: number): (px: number) => number {
  return scaleLinear([ML, ML + PLOT_W], [0, frameCount - 1])
}

export function seekOnClick(
  e: MouseEvent<SVGSVGElement>,
  xInvert: (px: number) => number,
  frameCount: number,
  store: SceneStore,
): void {
  const rect = e.currentTarget.getBoundingClientRect()
  const vbW = e.currentTarget.viewBox.baseVal.width
  const px = ((e.clientX - rect.left) / rect.width) * vbW
  const fi = Math.round(xInvert(px))
  store.getState().setFrameIndex(Math.max(0, Math.min(frameCount - 1, fi)))
}
