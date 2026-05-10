import { Suspense, useCallback, useEffect, useMemo, useState } from 'react'
import { Canvas } from '@react-three/fiber'
import { createSceneStore } from '../store/sceneStore'
import { SceneCtx, useSceneStore } from '../context'
import { SceneDataManager } from '../data/SceneDataManager'
import { useFrameData } from '../hooks/useFrameData'
import { layerRegistry } from '../registry/layerRegistry'
import { getStyle } from '../registry/defaultStyles'
import { CameraController } from './CameraController'
import { FrameSynchronizer } from './FrameSynchronizer'
import { ShaderPrecompiler } from './ShaderPrecompiler'
import { StreamPanel } from './StreamPanel'
import { CameraPanel } from './CameraPanel'
import { TimelineBar } from './TimelineBar'
import { EgoVehicle } from './EgoVehicle'
import { StatisticsPanel } from './StatisticsPanel'
import { PanelToggleBar } from './PanelToggleBar'
import { SelectedObjectIcon } from './SelectedObjectIcon'
import { ThemeTokensProvider } from '../themeContext'
import styles from './SceneViewer.module.css'

interface SceneViewerProps {
  sceneUrl: string
}

export default function SceneViewer({ sceneUrl }: SceneViewerProps) {
  const [store] = useState(() => createSceneStore())
  const [dataManager, setDataManager] = useState<SceneDataManager | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setLoading(true)
    setError(null)

    const manager = new SceneDataManager(sceneUrl)
    let cancelled = false

    manager
      .init()
      .then(({ metadata, initialStreamState }) => {
        if (cancelled) return
        store.getState().setMetadata(metadata, initialStreamState)
        setDataManager(manager)
        setLoading(false)
      })
      .catch((err: unknown) => {
        if (cancelled) return
        setError(err instanceof Error ? err.message : String(err))
        setLoading(false)
      })

    return () => {
      cancelled = true
      manager.destroy()
    }
  }, [sceneUrl, store])

  if (loading) return <div>Loading scene…</div>
  if (error || !dataManager) return <div>⚠ Failed to load scene: {error}</div>

  return (
    <SceneCtx.Provider value={{ store, dataManager }}>
      <ThemeTokensProvider>
        <SceneViewerInner />
      </ThemeTokensProvider>
    </SceneCtx.Provider>
  )
}

// Isolated leaf: subscribes to frameIndex but renders nothing,
// keeping frame-load re-renders out of the main layout tree.
function FrameDataSync() {
  useFrameData()
  return null
}

function SceneViewerInner() {
  const streamsMeta   = useSceneStore((s) => s.streamsMeta)
  const theme         = useSceneStore((s) => s.theme)
  const cameraMode    = useSceneStore((s) => s.cameraMode)
  const setCameraMode = useSceneStore((s) => s.setCameraMode)

  const [streamsOpen, setStreamsOpen] = useState(false)
  const [camerasOpen, setCamerasOpen] = useState(true)
  const [statsOpen, setStatsOpen]     = useState(true)

  const handleCloseStreams  = useCallback(() => setStreamsOpen(false), [])
  const handleCloseStats    = useCallback(() => setStatsOpen(false), [])
  const handleToggleStreams  = useCallback(() => setStreamsOpen((v) => !v), [])
  const handleToggleCameras = useCallback(() => setCamerasOpen((v) => !v), [])
  const handleToggleStats   = useCallback(() => setStatsOpen((v) => !v), [])

  const layers = useMemo(() => {
    return Object.entries(streamsMeta).flatMap(([streamName, meta]) => {
      if (meta.type === 'pose') return []
      const Renderer = layerRegistry[meta.type]
      if (!Renderer) return []
      return [{ streamName, Renderer }]
    })
  }, [streamsMeta])

  return (
    <div className={styles.root} data-theme={theme}>
      <FrameDataSync />

      <div className={styles.canvasArea}>
        {streamsOpen && <StreamPanel onClose={handleCloseStreams} />}
        {statsOpen && <StatisticsPanel onClose={handleCloseStats} />}
        {camerasOpen && <CameraPanel />}

        <Canvas
          flat
          camera={{ position: [0, -50, 80], up: [0, 0, 1], fov: 60 }}
          gl={{ antialias: true }}
        >
          <Suspense fallback={null}>
            <FrameSynchronizer />
            <CameraController />
            <ambientLight intensity={0.5} />
            <EgoVehicle />
            {layers.map(({ streamName, Renderer }) => (
              <Renderer
                key={streamName}
                streamName={streamName}
                style={getStyle(streamName)}
              />
            ))}
            <SelectedObjectIcon />
            <ShaderPrecompiler />
          </Suspense>
        </Canvas>

        <PanelToggleBar
          streamsOpen={streamsOpen}
          camerasOpen={camerasOpen}
          statsOpen={statsOpen}
          onToggleStreams={handleToggleStreams}
          onToggleCameras={handleToggleCameras}
          onToggleStats={handleToggleStats}
          cameraMode={cameraMode}
          onSetCameraMode={setCameraMode}
        />
      </div>

      <TimelineBar />
    </div>
  )
}
