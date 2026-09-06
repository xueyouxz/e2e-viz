import type { KeyboardEvent, MouseEvent } from 'react'
import { scaleLinear } from 'd3'
import type { SceneStore } from '../../store/sceneStore'

export const SVG_W = 256
export const ML = 0
const MR = 0
export const PLOT_W = SVG_W - ML - MR

export function arrayMax(arr: Float32Array | null): number {
  if (!arr || arr.length === 0) return 1
  let max = 0
  for (let i = 0; i < arr.length; i++) if (arr[i] > max) max = arr[i]
  return max || 1
}

export function makeXInvert(frameCount: number): (px: number) => number {
  return scaleLinear([ML, ML + PLOT_W], [0, frameCount - 1])
}

export function seekOnClick(
  e: MouseEvent<SVGSVGElement>,
  xInvert: (px: number) => number,
  frameCount: number,
  store: SceneStore
): void {
  if (frameCount <= 0) return
  const rect = e.currentTarget.getBoundingClientRect()
  if (rect.width <= 0) return
  const vbW = e.currentTarget.viewBox.baseVal.width
  const px = ((e.clientX - rect.left) / rect.width) * vbW
  const fi = Math.round(xInvert(px))
  store.getState().requestFrame(Math.max(0, Math.min(frameCount - 1, fi)))
}

export function seekOnKeyDown(
  event: KeyboardEvent<SVGSVGElement>,
  frameCount: number,
  store: SceneStore
): void {
  if (frameCount <= 0 || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
  event.preventDefault()
  const frame = store.getState().displayedFrameIndex
  const next =
    event.key === 'Home'
      ? 0
      : event.key === 'End'
        ? frameCount - 1
        : frame + (event.key === 'ArrowLeft' ? -1 : 1)
  store.getState().requestFrame(Math.max(0, Math.min(frameCount - 1, next)))
}
