import { useLayoutEffect, useRef, useState } from 'react'
import { useSceneStoreApi } from '../context'
import { Loading } from '../Loading'
import type { SceneState } from '../store/sceneStore'
import type { CuboidPayload, ImagePayload } from '../types'
import {
  computeViewportTransform,
  createCanvasRenderScratch,
  pickTrackAtViewportPoint,
  renderProjectedCuboids
} from './cameraRendering'
import type { CameraViewportTransform } from './cameraRendering'
import { CameraProjector } from './cameraProjection'
import type { CameraChannel, ProjectedCuboid } from './cameraProjection'
import './CameraPanel.css'

const CUBOID_STREAM = '/gt/objects/bounds'

const cls = {
  content: 'flex h-full flex-col overflow-hidden border-t border-app-border bg-app-panel-bg-solid',
  grid: 'flex min-h-0 flex-1 flex-col gap-px overflow-hidden bg-app-grid-gap p-px',
  row: 'grid min-h-0 flex-1 grid-cols-3 gap-px',
  cell: 'relative flex min-h-0 flex-col overflow-hidden bg-app-cell-bg',
  viewport: 'relative flex min-h-0 flex-1 cursor-crosshair overflow-hidden',
  image: 'block h-full w-full object-cover',
  projectionCanvas: 'pointer-events-none absolute inset-0 h-full w-full'
}

const CAMERA_ROWS: CameraChannel[][] = [
  ['CAM_FRONT_LEFT', 'CAM_FRONT', 'CAM_FRONT_RIGHT'],
  ['CAM_BACK_LEFT', 'CAM_BACK', 'CAM_BACK_RIGHT']
]

interface CameraViewportProps {
  channel: CameraChannel
  projector: CameraProjector
  active: boolean
}

interface ViewportState {
  imagePayload?: ImagePayload
  sourceWidth: number
  sourceHeight: number
  viewportWidth: number
  viewportHeight: number
  viewportTransform: CameraViewportTransform
  projectionVersion: number
  selectedTrackId: number | null
  projectedCuboids: ProjectedCuboid[]
  hasImage: boolean
}

function containsTrack(projectedCuboids: ProjectedCuboid[], trackId: number | null): boolean {
  if (trackId == null) return false
  for (const projectedCuboid of projectedCuboids) {
    if (projectedCuboid.trackId === trackId) return true
  }
  return false
}

function CameraViewport({ channel, projector, active }: CameraViewportProps) {
  const store = useSceneStoreApi()
  const viewportRef = useRef<HTMLDivElement>(null)
  const imageRef = useRef<HTMLImageElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const loadingRef = useRef<HTMLDivElement>(null)
  const renderScratchRef = useRef(createCanvasRenderScratch())
  const viewportStateRef = useRef<ViewportState>({
    sourceWidth: 1600,
    sourceHeight: 900,
    viewportWidth: 0,
    viewportHeight: 0,
    viewportTransform: computeViewportTransform(0, 0, 1600, 900, 'cover'),
    projectionVersion: -1,
    selectedTrackId: null,
    projectedCuboids: [],
    hasImage: false
  })

  useLayoutEffect(() => {
    if (!active) return
    const viewport = viewportRef.current
    const image = imageRef.current
    const canvas = canvasRef.current
    const loading = loadingRef.current
    if (!viewport || !image || !canvas || !loading) return
    const viewportState = viewportStateRef.current

    const handleImageLoad = () => {
      loading.style.display = 'none'
    }
    const handleImageError = () => {
      loading.style.display = 'none'
      image.style.display = 'none'
    }
    image.addEventListener('load', handleImageLoad)
    image.addEventListener('error', handleImageError)

    const renderViewport = (state: SceneState, forceRender = false) => {
      const imagePayload = state.streamState[`/camera/${channel}`] as ImagePayload | undefined
      const hasImage = Boolean(imagePayload?.url)
      let imageChanged = false
      if (imagePayload !== viewportState.imagePayload) {
        viewportState.imagePayload = imagePayload
        imageChanged = true
        loading.style.display = 'flex'
        if (imagePayload?.url) {
          image.src = imagePayload.url
          image.style.display = 'block'
        } else {
          image.removeAttribute('src')
          image.style.display = 'none'
        }
      }

      const camera = state.cameras[channel]
      const sourceWidth = camera?.image_width ?? 1600
      const sourceHeight = camera?.image_height ?? 900
      const sourceChanged =
        sourceWidth !== viewportState.sourceWidth || sourceHeight !== viewportState.sourceHeight
      if (sourceChanged) {
        viewportState.sourceWidth = sourceWidth
        viewportState.sourceHeight = sourceHeight
        viewportState.viewportTransform = computeViewportTransform(
          viewportState.viewportWidth,
          viewportState.viewportHeight,
          sourceWidth,
          sourceHeight,
          'cover'
        )
      }

      const projectionFrame = projector.projectFrame(
        state.streamState[CUBOID_STREAM] as CuboidPayload | undefined,
        state.egoPose,
        state.cameras
      )
      const projectedCuboids = projectionFrame.projectedCuboids[channel]
      const projectionChanged = projectionFrame.version !== viewportState.projectionVersion
      const selectedChanged = state.selectedTrackId !== viewportState.selectedTrackId
      const selectionAffectsViewport =
        selectedChanged &&
        (containsTrack(projectedCuboids, viewportState.selectedTrackId) ||
          containsTrack(projectedCuboids, state.selectedTrackId))

      viewportState.projectionVersion = projectionFrame.version
      viewportState.selectedTrackId = state.selectedTrackId
      viewportState.projectedCuboids = projectedCuboids
      viewportState.hasImage = hasImage

      if (!hasImage) {
        const context = canvas.getContext('2d')
        context?.clearRect(0, 0, canvas.width, canvas.height)
        return
      }
      if (
        !forceRender &&
        !imageChanged &&
        !sourceChanged &&
        !projectionChanged &&
        !selectionAffectsViewport
      ) {
        return
      }
      renderProjectedCuboids(
        canvas,
        projectedCuboids,
        viewportState.viewportTransform,
        state.selectedTrackId,
        renderScratchRef.current,
        window.devicePixelRatio || 1
      )
    }

    const updateViewportSize = (width: number, height: number) => {
      const nextWidth = Math.round(width)
      const nextHeight = Math.round(height)
      if (
        nextWidth === viewportState.viewportWidth &&
        nextHeight === viewportState.viewportHeight &&
        canvas.width === Math.floor(nextWidth * (window.devicePixelRatio || 1)) &&
        canvas.height === Math.floor(nextHeight * (window.devicePixelRatio || 1))
      ) {
        return
      }
      viewportState.viewportWidth = nextWidth
      viewportState.viewportHeight = nextHeight
      viewportState.viewportTransform = computeViewportTransform(
        nextWidth,
        nextHeight,
        viewportState.sourceWidth,
        viewportState.sourceHeight,
        'cover'
      )
      renderViewport(store.getState(), true)
    }

    const resizeObserver = new ResizeObserver(entries => {
      const entry = entries[0]
      if (entry) updateViewportSize(entry.contentRect.width, entry.contentRect.height)
    })
    const handleWindowResize = () => {
      const rect = viewport.getBoundingClientRect()
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
      renderViewport(state)
    })

    resizeObserver.observe(viewport)
    window.addEventListener('resize', handleWindowResize)
    const rect = viewport.getBoundingClientRect()
    updateViewportSize(rect.width, rect.height)
    renderViewport(store.getState(), true)
    if (image.complete && image.getAttribute('src')) {
      if (image.naturalWidth > 0) handleImageLoad()
      else handleImageError()
    }

    return () => {
      unsubscribe()
      resizeObserver.disconnect()
      window.removeEventListener('resize', handleWindowResize)
      image.removeEventListener('load', handleImageLoad)
      image.removeEventListener('error', handleImageError)
    }
  }, [channel, projector, store, active])

  const handleClick = (event: React.MouseEvent<HTMLDivElement>) => {
    const viewportState = viewportStateRef.current
    if (!viewportState.hasImage) return
    const rect = event.currentTarget.getBoundingClientRect()
    const trackId = pickTrackAtViewportPoint(
      event.clientX - rect.left,
      event.clientY - rect.top,
      viewportState.projectedCuboids,
      viewportState.viewportTransform
    )
    store.getState().setSelectedTrackId(trackId)
  }

  return (
    <div className={cls.cell}>
      <div ref={viewportRef} className={cls.viewport} onClick={handleClick}>
        <img
          ref={imageRef}
          alt={channel}
          className={cls.image}
          draggable={false}
          style={{ display: 'none' }}
        />
        <canvas ref={canvasRef} className={cls.projectionCanvas} />
        <Loading ref={loadingRef} />
      </div>
    </div>
  )
}

export function CameraPanel({ open }: { open: boolean }) {
  const [projector] = useState(() => new CameraProjector())
  return (
    <div
      className='scene-camera-panel'
      data-open={open}
      aria-label='Camera images'
      aria-hidden={!open}
      inert={!open}
    >
      <div className={cls.content}>
        <div className={cls.grid}>
          {CAMERA_ROWS.map(row => (
            <div key={row.join('-')} className={cls.row}>
              {row.map(channel => (
                <CameraViewport
                  key={channel}
                  channel={channel}
                  projector={projector}
                  active={open}
                />
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
