import {
  Suspense,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useState,
  type ComponentType
} from 'react'
import { PanelRightOpen } from 'lucide-react'
import './SceneViewer.css'
import { Canvas } from '@react-three/fiber'
import { createSceneStore, type SceneStore } from './store/sceneStore'
import { SceneCtx, useSceneStore } from './context'
import { SceneManager } from './SceneManager'
import { getStyle } from './styleConfig'
import { SceneContent } from './scene/SceneContent'
import { CuboidLayer } from './layers/CuboidLayer'
import { ImageLayer } from './layers/ImageLayer'
import { PointLayer } from './layers/PointLayer'
import { PolygonLayer } from './layers/PolygonLayer'
import { PolylineLayer } from './layers/PolylineLayer'
import { StreamPanel } from './panels/StreamPanel'
import { CameraPanel } from './camera/CameraPanel'
import { CameraViewControl } from './camera/CameraViewControl'
import { StatisticsPanel } from './panels/StatisticsPanel'
import { PanelToggleBar } from './panels/PanelToggleBar'
import { Playback } from './playback/Playback'
import { Loading } from './Loading'
import type { StreamLayerProps, StreamType } from './types'

const STREAM_LAYERS: Partial<Record<StreamType, ComponentType<StreamLayerProps>>> = {
  cuboid: CuboidLayer,
  image: ImageLayer,
  point: PointLayer,
  polygon: PolygonLayer,
  polyline: PolylineLayer
}

export interface SceneViewerProps {
  sceneUrl: string
}

export default function SceneViewer({ sceneUrl }: SceneViewerProps) {
  const [store] = useState(() => createSceneStore())
  const contextValue = useMemo(() => ({ store }), [store])
  const scene = useSceneManager(sceneUrl, store)

  return (
    <SceneCtx.Provider value={contextValue}>
      <SceneWorkspace isSceneLoading={scene.status === 'loading'} error={scene.error} />
    </SceneCtx.Provider>
  )
}

interface SceneManagerState {
  status: 'loading' | 'ready' | 'failed'
  error: string | null
}

function useSceneManager(sceneUrl: string, store: SceneStore): SceneManagerState {
  const [state, setState] = useState<SceneManagerState>({ status: 'loading', error: null })

  useEffect(() => {
    const manager = new SceneManager(sceneUrl, store)
    let isCurrentManager = true
    setState({ status: 'loading', error: null })

    manager
      .start()
      .then(() => {
        if (isCurrentManager) setState({ status: 'ready', error: null })
      })
      .catch((error: unknown) => {
        if (!isCurrentManager) return
        setState({
          status: 'failed',
          error: error instanceof Error ? error.message : String(error)
        })
      })

    return () => {
      isCurrentManager = false
      manager.destroy()
    }
  }, [sceneUrl, store])

  return state
}

function SceneWorkspace({
  isSceneLoading,
  error
}: {
  isSceneLoading: boolean
  error: string | null
}) {
  const streamsMeta = useSceneStore(s => s.streamsMeta)
  const panelId = useId()
  const [activeTab, setActiveTab] = useState<'streams' | 'stats'>('stats')
  const [detailsOpen, setDetailsOpen] = useState(true)
  const [camerasOpen, setCamerasOpen] = useState(true)
  const [isCanvasReady, setIsCanvasReady] = useState(false)
  const handleCanvasReady = useCallback(() => setIsCanvasReady(true), [])

  const streamLayers = useMemo(() => {
    return Object.entries(streamsMeta).flatMap(([streamName, meta]) => {
      if (meta.type === 'pose') return []
      const Layer = STREAM_LAYERS[meta.type]
      if (!Layer) return []
      return [{ streamName, Layer }]
    })
  }, [streamsMeta])

  return (
    <div className='scene-workspace flex h-full w-full'>
      <div className='relative flex min-h-0 min-w-0 flex-1 flex-col'>
        {!detailsOpen && (
          <button
            className='absolute top-3 right-3 z-10 grid h-8 w-8 cursor-pointer place-items-center rounded border-0 bg-app-panel-bg-solid text-app-text-label shadow-sm hover:bg-app-row-hover focus-visible:outline-2 focus-visible:outline-accent'
            type='button'
            aria-label='Expand details panel'
            title='Expand details panel'
            aria-expanded={false}
            aria-controls={panelId}
            onClick={() => setDetailsOpen(true)}
          >
            <PanelRightOpen size={15} aria-hidden='true' />
          </button>
        )}
        <div className='relative min-h-0 flex-1' aria-label='3D viewport'>
          {error ? (
            <div className='flex h-full items-center justify-center bg-app-surface-raised p-6 text-center text-sm text-app-text-muted'>
              无法加载场景：{error}
            </div>
          ) : (
            <>
              <Canvas
                flat
                // ResizeObserver uses the measure hook's scroll debounce too.
                // Disable both delays so the drawing buffer follows the panel transition.
                resize={{ debounce: 0 }}
                className='[&_canvas]:h-full! [&_canvas]:w-full!'
                camera={{ position: [0, -50, 80], up: [0, 0, 1], fov: 60 }}
                gl={{ antialias: true }}
              >
                <Suspense fallback={null}>
                  <SceneContent />
                  {streamLayers.map(({ streamName, Layer }) => (
                    <Layer key={streamName} streamName={streamName} style={getStyle(streamName)} />
                  ))}
                  <CanvasReady onReady={handleCanvasReady} />
                </Suspense>
              </Canvas>

              {(isSceneLoading || !isCanvasReady) && <Loading className='z-[4]' />}

              <CameraViewControl />
            </>
          )}
        </div>
        {!error && <CameraPanel open={camerasOpen} />}
        <Playback />
      </div>
      <aside
        id={panelId}
        className='scene-details-panel bg-app-panel-bg-solid'
        data-open={detailsOpen}
        aria-hidden={!detailsOpen}
        inert={!detailsOpen}
        aria-label='Scene details panel'
      >
        <div className='scene-details-content flex h-full flex-col border-l border-app-border'>
          <PanelToggleBar
            onCollapse={() => setDetailsOpen(false)}
            activeTab={activeTab}
            onTabChange={setActiveTab}
            panelId={panelId}
            camerasOpen={camerasOpen}
            onToggleCameras={() => setCamerasOpen(value => !value)}
          />
          <div className='min-h-0 flex-1'>
            <div
              id={`${panelId}-streams`}
              role='tabpanel'
              aria-labelledby={`${panelId}-streams-tab`}
              hidden={activeTab !== 'streams'}
              className='h-full'
            >
              <StreamPanel />
            </div>
            <div
              id={`${panelId}-stats`}
              role='tabpanel'
              aria-labelledby={`${panelId}-stats-tab`}
              hidden={activeTab !== 'stats'}
              className='h-full'
            >
              <StatisticsPanel />
            </div>
          </div>
        </div>
      </aside>
    </div>
  )
}

function CanvasReady({ onReady }: { onReady: () => void }) {
  useEffect(onReady, [onReady])
  return null
}
