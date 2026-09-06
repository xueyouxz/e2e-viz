import { ExternalLink } from 'lucide-react'
import { Suspense, lazy, useMemo, useState } from 'react'
import { Loading } from '@/features/scene-viewer/Loading'
import { ProjectionMapView, type ProjectionViewRequest } from './components/ProjectionMapView'
import { SceneListPanel } from './components/SceneListPanel'
import { SceneSummary } from './components/SceneSummary'
import { glyphAtlasLoader } from './glyph/glyphAtlas'
import { useProjectionMapData } from './data/useProjectionMapData'
import { useSceneMetadata } from './data/useSceneMetadata'
import { projectionDataLoader } from './data/projectionData'
import { useScenePreview } from './useScenePreview'
import type { ProjectionMapPoint, SplitMode, SplitName } from './types'

const SceneViewer = lazy(() =>
  import('@/features/scene-viewer').then(module => ({ default: module.SceneViewer }))
)

const splitModes: Record<SplitName, SplitMode> = { train: 'glyph', val: 'glyph' }

// The projection and atlas are independent. Start both as soon as this route
// module is evaluated instead of waiting for a component effect waterfall.
void Promise.allSettled([projectionDataLoader.load(), glyphAtlasLoader.load()])

const cls = {
  page: 'relative flex h-screen w-full flex-col overflow-hidden',
  header:
    'flex h-9 shrink-0 items-center justify-between gap-4 border-b border-app-page-border bg-white px-4',
  headerTitle: 'text-[0.9375rem] font-semibold tracking-[0.02em] whitespace-nowrap text-app-text',
  content: 'flex min-h-0 flex-1 flex-row overflow-hidden',
  sidebar:
    'grid w-[clamp(280px,21vw,320px)] shrink-0 grid-rows-[auto_minmax(0,1fr)] gap-px overflow-hidden border-r border-app-page-border bg-app-page-border max-[720px]:w-[min(50vw,280px)]',
  status: 'grid min-h-0 min-w-0 flex-1 place-items-center bg-[#f7f8fb] text-[#647084]',
  error:
    'absolute top-4 left-1/2 max-w-[min(38rem,calc(100%-2rem))] -translate-x-1/2 rounded-lg border border-[#f2bcc5] bg-[#fff0f2] px-3.5 py-2.5 text-[#8f1d2c]',
  workspace: 'relative min-h-0 min-w-0 flex-1 overflow-hidden',
  projection: 'absolute inset-0 flex',
  scene: 'absolute inset-0 flex flex-col bg-app-surface-raised',
  toast:
    'pointer-events-none fixed right-6 bottom-6 z-[300] animate-toast rounded-lg border border-[#f5c97a] bg-[#fef3e2] px-3.5 py-2 text-[0.8125rem] font-medium text-[#5a3e1b] shadow-[0_4px_16px_rgb(15_23_42/12%)] max-[720px]:right-4 max-[720px]:bottom-4'
}

export default function ProjectionMapPage() {
  const [selectedScenes, setSelectedScenes] = useState<ProjectionMapPoint[]>([])
  const [highlightedScenes, setHighlightedScenes] = useState<ProjectionMapPoint[]>([])
  const [viewRequest, setViewRequest] = useState<ProjectionViewRequest | null>(null)
  const [split, setSplit] = useState<SplitName | null>(null)
  const [location, setLocation] = useState<string | null>(null)
  const { activeScene, toast, open, close } = useScenePreview()
  const { points, loading, error } = useProjectionMapData()
  const metadata = useSceneMetadata(points.length > 0)
  const filteredPoints = useMemo(
    () =>
      points.filter(
        point =>
          (split === null || point.split === split) &&
          (location === null || metadata?.get(point.scene_name)?.location === location)
      ),
    [points, metadata, split, location]
  )
  const hasSceneSelection =
    selectedScenes.length > 0 && selectedScenes.length < filteredPoints.length
  const listedScenes = hasSceneSelection ? selectedScenes : filteredPoints

  function clearSelection(): void {
    setSelectedScenes([])
    setHighlightedScenes([])
    setViewRequest(null)
  }

  function requestProjectionView(requestedPoints: ProjectionMapPoint[], highlight = true): void {
    close()
    setHighlightedScenes(highlight ? requestedPoints : [])
    setViewRequest(previous => ({
      points: requestedPoints,
      requestId: (previous?.requestId ?? 0) + 1
    }))
  }

  return (
    <main className={cls.page}>
      <header className={cls.header}>
        <span className={cls.headerTitle}>Autonomous Driving Scene Explorer</span>
        <nav className='flex shrink-0 items-center gap-4 text-xs' aria-label='Project resources'>
          <a
            className='inline-flex items-center gap-1.5 text-app-text-muted hover:text-accent focus-visible:underline'
            href='https://www.nuscenes.org/'
            target='_blank'
            rel='noopener noreferrer'
          >
            <img src='/icons/nuscenes.ico' alt='' className='h-3.5 w-3.5' />
            nuScenes
            <ExternalLink size={11} aria-hidden='true' />
          </a>
          <a
            className='inline-flex items-center gap-1.5 text-app-text-muted hover:text-accent focus-visible:underline'
            href='https://github.com/swc-17/sparsedrive'
            target='_blank'
            rel='noopener noreferrer'
          >
            <img src='/icons/github.svg' alt='' className='h-3.5 w-3.5' />
            SparseDrive
            <ExternalLink size={11} aria-hidden='true' />
          </a>
        </nav>
      </header>

      <div className={cls.content}>
        <aside className={cls.sidebar} aria-label='Scene overview and selection'>
          <SceneSummary
            points={points}
            metadata={metadata}
            split={split}
            location={location}
            loading={loading}
            onSplitChange={id => {
              setSplit(previous => (previous === id ? null : id))
              clearSelection()
            }}
            onLocationChange={id => {
              setLocation(previous => (previous === id ? null : id))
              clearSelection()
            }}
          />
          <SceneListPanel
            scenes={listedScenes}
            searchableScenes={filteredPoints}
            hasFilters={split !== null || location !== null}
            onReset={() => {
              setSplit(null)
              setLocation(null)
              clearSelection()
              requestProjectionView(points, false)
            }}
            onScenesLocate={requestProjectionView}
            onSceneOpen={open}
            activeScene={activeScene}
          />
        </aside>

        <div className={cls.workspace}>
          <div
            className={`${cls.projection} ${activeScene ? 'invisible' : ''}`}
            aria-hidden={!!activeScene}
            inert={!!activeScene}
          >
            {loading ? (
              <div className={cls.status}>Loading projection data...</div>
            ) : (
              <ProjectionMapView
                points={filteredPoints}
                allPoints={points}
                selectedScenes={selectedScenes}
                highlightedScenes={highlightedScenes}
                splitModes={splitModes}
                viewRequest={viewRequest}
                onGlyphClick={open}
                onSelectionChange={scenes => {
                  setHighlightedScenes([])
                  setSelectedScenes(scenes.length === filteredPoints.length ? [] : scenes)
                }}
              />
            )}
          </div>
          {activeScene && (
            <section className={cls.scene} aria-label='3D scene viewer'>
              <div className='relative min-h-0 flex-1'>
                <Suspense fallback={<Loading />}>
                  <SceneViewer key={activeScene} sceneUrl={`/data/scenes/${activeScene}/`} />
                </Suspense>
              </div>
            </section>
          )}
        </div>
      </div>

      {error && <div className={cls.error}>{error}</div>}

      {/* No-data toast */}
      {toast && (
        <div className={cls.toast} role='status'>
          {toast.availability === 'temporary-error'
            ? `${toast.sceneName} 数据暂时加载失败，请重试`
            : `${toast.sceneName} 暂无详情数据`}
        </div>
      )}
    </main>
  )
}
