import { useLayoutEffect, useRef, useState } from 'react'
import { useSceneStoreApi } from '../context'
import type { SceneState } from '../store/sceneStore'
import type { CuboidPayload, ImagePayload } from '../types'
import {
  computeViewportTransform,
  drawCameraOverlay,
  pickTrackAtViewportPoint
} from './CameraOverlayCanvas'
import { CameraOverlayProjector } from './CameraOverlayProjector'
import { createWireframeDrawScratch } from './wireframe'
import type { CameraChannel, CameraViewportTransform, ProjectedBox3DWireframe } from './types'

const CUBOID_STREAM = '/gt/objects/bounds'

const cls = {
  panel:
    'absolute right-0 bottom-0 left-0 z-[5] flex h-2/5 flex-col overflow-hidden border-t border-app-border bg-app-panel-bg-solid',
  grid: 'flex min-h-0 flex-1 flex-col gap-px overflow-hidden bg-app-grid-gap p-px',
  row: 'grid min-h-0 flex-1 grid-cols-3 gap-px',
  cell: 'relative flex min-h-0 flex-col overflow-hidden bg-app-cell-bg',
  mediaWrap: 'relative flex min-h-0 flex-1 cursor-crosshair overflow-hidden',
  thumb: 'block h-full w-full object-cover',
  overlayCanvas: 'pointer-events-none absolute inset-0 h-full w-full',
  placeholder:
    'absolute inset-0 flex items-center justify-center text-[10px] tracking-[0.06em] text-app-placeholder-text uppercase'
}

const CAMERA_ROWS: CameraChannel[][] = [
  ['CAM_FRONT_LEFT', 'CAM_FRONT', 'CAM_FRONT_RIGHT'],
  ['CAM_BACK_LEFT', 'CAM_BACK', 'CAM_BACK_RIGHT']
]

interface CameraViewportProps {
  channel: CameraChannel
  projector: CameraOverlayProjector
}

interface ViewportRuntime {
  imagePayload?: ImagePayload
  sourceWidth: number
  sourceHeight: number
  viewportWidth: number
  viewportHeight: number
  viewportTransform: CameraViewportTransform
  overlayVersion: number
  selectedTrackId: number | null
  projectedCuboids: ProjectedBox3DWireframe[]
  hasImage: boolean
}

function containsTrack(
  projectedCuboids: ProjectedBox3DWireframe[],
  trackId: number | null
): boolean {
  if (trackId == null) return false
  for (const projectedCuboid of projectedCuboids) {
    if (projectedCuboid.trackId === trackId) return true
  }
  return false
}

function CameraViewport({ channel, projector }: CameraViewportProps) {
  const store = useSceneStoreApi()
  const mediaRef = useRef<HTMLDivElement>(null)
  const imageRef = useRef<HTMLImageElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const placeholderRef = useRef<HTMLDivElement>(null)
  const wireframeScratchRef = useRef(createWireframeDrawScratch())
  const runtimeRef = useRef<ViewportRuntime>({
    sourceWidth: 1600,
    sourceHeight: 900,
    viewportWidth: 0,
    viewportHeight: 0,
    viewportTransform: computeViewportTransform(0, 0, 1600, 900, 'cover'),
    overlayVersion: -1,
    selectedTrackId: null,
    projectedCuboids: [],
    hasImage: false
  })

  useLayoutEffect(() => {
    const media = mediaRef.current
    const image = imageRef.current
    const canvas = canvasRef.current
    const placeholder = placeholderRef.current
    if (!media || !image || !canvas || !placeholder) return
    const runtime = runtimeRef.current

    const draw = (state: SceneState, force = false) => {
      const imagePayload = state.streamState[`/camera/${channel}`] as ImagePayload | undefined
      const hasImage = Boolean(imagePayload?.url)
      let imageChanged = false
      if (imagePayload !== runtime.imagePayload) {
        runtime.imagePayload = imagePayload
        imageChanged = true
        if (imagePayload?.url) {
          image.src = imagePayload.url
          image.style.display = 'block'
          placeholder.style.display = 'none'
        } else {
          image.removeAttribute('src')
          image.style.display = 'none'
          placeholder.style.display = 'flex'
        }
      }

      const camera = state.cameras[channel]
      const sourceWidth = camera?.image_width ?? 1600
      const sourceHeight = camera?.image_height ?? 900
      const sourceChanged =
        sourceWidth !== runtime.sourceWidth || sourceHeight !== runtime.sourceHeight
      if (sourceChanged) {
        runtime.sourceWidth = sourceWidth
        runtime.sourceHeight = sourceHeight
        runtime.viewportTransform = computeViewportTransform(
          runtime.viewportWidth,
          runtime.viewportHeight,
          sourceWidth,
          sourceHeight,
          'cover'
        )
      }

      const overlayFrame = projector.projectFrame(
        state.streamState[CUBOID_STREAM] as CuboidPayload | undefined,
        state.egoPose,
        state.cameras
      )
      const projectedCuboids = overlayFrame.projectedCuboids[channel]
      const overlayChanged = overlayFrame.version !== runtime.overlayVersion
      const selectedChanged = state.selectedTrackId !== runtime.selectedTrackId
      const selectionAffectsViewport =
        selectedChanged &&
        (containsTrack(projectedCuboids, runtime.selectedTrackId) ||
          containsTrack(projectedCuboids, state.selectedTrackId))

      runtime.overlayVersion = overlayFrame.version
      runtime.selectedTrackId = state.selectedTrackId
      runtime.projectedCuboids = projectedCuboids
      runtime.hasImage = hasImage

      if (!hasImage) {
        const context = canvas.getContext('2d')
        context?.clearRect(0, 0, canvas.width, canvas.height)
        return
      }
      if (
        !force &&
        !imageChanged &&
        !sourceChanged &&
        !overlayChanged &&
        !selectionAffectsViewport
      ) {
        return
      }
      drawCameraOverlay(
        canvas,
        projectedCuboids,
        runtime.viewportTransform,
        state.selectedTrackId,
        wireframeScratchRef.current,
        window.devicePixelRatio || 1
      )
    }

    const updateViewportSize = (width: number, height: number) => {
      const nextWidth = Math.round(width)
      const nextHeight = Math.round(height)
      if (
        nextWidth === runtime.viewportWidth &&
        nextHeight === runtime.viewportHeight &&
        canvas.width === Math.floor(nextWidth * (window.devicePixelRatio || 1)) &&
        canvas.height === Math.floor(nextHeight * (window.devicePixelRatio || 1))
      ) {
        return
      }
      runtime.viewportWidth = nextWidth
      runtime.viewportHeight = nextHeight
      runtime.viewportTransform = computeViewportTransform(
        nextWidth,
        nextHeight,
        runtime.sourceWidth,
        runtime.sourceHeight,
        'cover'
      )
      draw(store.getState(), true)
    }

    const resizeObserver = new ResizeObserver(entries => {
      const entry = entries[0]
      if (entry) updateViewportSize(entry.contentRect.width, entry.contentRect.height)
    })
    const handleWindowResize = () => {
      const rect = media.getBoundingClientRect()
      updateViewportSize(rect.width, rect.height)
    }
    const unsubscribe = store.subscribe((state, previousState) => {
      if (
        state.streamState[`/camera/${channel}`] ===
          previousState.streamState[`/camera/${channel}`] &&
        state.streamState[CUBOID_STREAM] === previousState.streamState[CUBOID_STREAM] &&
        state.egoPose === previousState.egoPose &&
        state.cameras === previousState.cameras &&
        state.selectedTrackId === previousState.selectedTrackId
      ) {
        return
      }
      draw(state)
    })

    resizeObserver.observe(media)
    window.addEventListener('resize', handleWindowResize)
    const rect = media.getBoundingClientRect()
    updateViewportSize(rect.width, rect.height)
    draw(store.getState(), true)

    return () => {
      unsubscribe()
      resizeObserver.disconnect()
      window.removeEventListener('resize', handleWindowResize)
    }
  }, [channel, projector, store])

  const handleClick = (event: React.MouseEvent<HTMLDivElement>) => {
    const runtime = runtimeRef.current
    if (!runtime.hasImage) return
    const rect = event.currentTarget.getBoundingClientRect()
    const trackId = pickTrackAtViewportPoint(
      event.clientX - rect.left,
      event.clientY - rect.top,
      runtime.projectedCuboids,
      runtime.viewportTransform
    )
    store.getState().setSelectedTrackId(trackId)
  }

  return (
    <div className={cls.cell}>
      <div ref={mediaRef} className={cls.mediaWrap} onClick={handleClick}>
        <img
          ref={imageRef}
          alt={channel}
          className={cls.thumb}
          draggable={false}
          style={{ display: 'none' }}
        />
        <canvas ref={canvasRef} className={cls.overlayCanvas} />
        <div ref={placeholderRef} className={cls.placeholder} />
      </div>
    </div>
  )
}

export function CameraPanel() {
  const [projector] = useState(() => new CameraOverlayProjector())
  return (
    <div className={cls.panel}>
      <div className={cls.grid}>
        {CAMERA_ROWS.map(row => (
          <div key={row.join('-')} className={cls.row}>
            {row.map(channel => (
              <CameraViewport key={channel} channel={channel} projector={projector} />
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}
