import { drawPseudo3DWireframes } from './wireframe'
import type { WireframeDrawScratch } from './wireframe'
import type { CameraViewportTransform, OverlayFitMode, ProjectedBox3DWireframe } from './types'

export function computeViewportTransform(
  viewportWidth: number,
  viewportHeight: number,
  sourceWidth: number,
  sourceHeight: number,
  fitMode: OverlayFitMode
): CameraViewportTransform {
  if (viewportWidth <= 0 || viewportHeight <= 0 || sourceWidth <= 0 || sourceHeight <= 0) {
    return {
      scale: 1,
      offsetX: 0,
      offsetY: 0,
      viewportWidth,
      viewportHeight,
      sourceWidth,
      sourceHeight
    }
  }

  const scale =
    fitMode === 'cover'
      ? Math.max(viewportWidth / sourceWidth, viewportHeight / sourceHeight)
      : Math.min(viewportWidth / sourceWidth, viewportHeight / sourceHeight)
  return {
    scale,
    offsetX: (viewportWidth - sourceWidth * scale) / 2,
    offsetY: (viewportHeight - sourceHeight * scale) / 2,
    viewportWidth,
    viewportHeight,
    sourceWidth,
    sourceHeight
  }
}

export function pickTrackAtViewportPoint(
  viewportX: number,
  viewportY: number,
  projectedCuboids: ProjectedBox3DWireframe[],
  viewportTransform: CameraViewportTransform,
  margin = 12
): number | null {
  const imageX = (viewportX - viewportTransform.offsetX) / viewportTransform.scale
  const imageY = (viewportY - viewportTransform.offsetY) / viewportTransform.scale
  let bestTrackId: number | null = null
  let bestArea = Infinity

  for (const projectedCuboid of projectedCuboids) {
    const { minU, maxU, minV, maxV } = projectedCuboid.bounds
    if (
      imageX < minU - margin ||
      imageX > maxU + margin ||
      imageY < minV - margin ||
      imageY > maxV + margin
    ) {
      continue
    }
    const area = (maxU - minU) * (maxV - minV)
    if (area < bestArea) {
      bestArea = area
      bestTrackId = projectedCuboid.trackId
    }
  }
  return bestTrackId
}

export function drawCameraOverlay(
  canvas: HTMLCanvasElement,
  projectedCuboids: ProjectedBox3DWireframe[],
  viewportTransform: CameraViewportTransform,
  selectedTrackId: number | null,
  scratch: WireframeDrawScratch,
  devicePixelRatio: number
): void {
  const width = viewportTransform.viewportWidth
  const height = viewportTransform.viewportHeight
  if (width <= 0 || height <= 0) return

  const pixelRatio = Math.max(1, devicePixelRatio)
  const pixelWidth = Math.max(1, Math.floor(width * pixelRatio))
  const pixelHeight = Math.max(1, Math.floor(height * pixelRatio))
  if (canvas.width !== pixelWidth) canvas.width = pixelWidth
  if (canvas.height !== pixelHeight) canvas.height = pixelHeight

  const context = canvas.getContext('2d')
  if (!context) return
  context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0)
  context.clearRect(0, 0, width, height)
  context.save()
  context.translate(viewportTransform.offsetX, viewportTransform.offsetY)
  context.scale(viewportTransform.scale, viewportTransform.scale)
  drawPseudo3DWireframes(
    context,
    projectedCuboids,
    {
      clipMinU: -viewportTransform.offsetX / viewportTransform.scale,
      clipMaxU: (width - viewportTransform.offsetX) / viewportTransform.scale,
      clipMinV: -viewportTransform.offsetY / viewportTransform.scale,
      clipMaxV: (height - viewportTransform.offsetY) / viewportTransform.scale,
      cullMargin: 24 / viewportTransform.scale,
      displayScale: viewportTransform.scale,
      selectedTrackId
    },
    scratch
  )
  context.restore()
}
