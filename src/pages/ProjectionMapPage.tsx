import { Suspense, lazy, useCallback, useEffect, useRef, useState } from 'react'
import { ProjectionMapView } from '@/components/projection-map/ProjectionMapView'
import { glyphAtlasLoader } from '@/components/projection-map/glyph/glyphAtlas'
import { SceneListPanel } from '@/components/scene-list/SceneListPanel'
import { useProjectionMapData } from '@/hooks/useProjectionMapData'
import { sceneAvailabilityProbe, type SceneAvailability } from '@/lib/sceneAvailability'
import { projectionDataLoader } from '@/features/projection-map/data/projectionData'
import type { ProjectionMapPoint } from '@/types/scene'

const SceneViewer = lazy(() => import('@/features/scene-viewer/SceneViewer'))

// The projection and atlas are independent. Start both as soon as this route
// module is evaluated instead of waiting for a component effect waterfall.
void Promise.allSettled([projectionDataLoader.load(), glyphAtlasLoader.load()])

const cls = {
  page: 'relative flex h-screen w-full flex-col overflow-hidden',
  header:
    'flex h-11 shrink-0 items-center justify-between gap-4 border-b border-app-page-border bg-white pr-4 pl-5',
  headerTitle: 'text-[0.9375rem] font-semibold tracking-[0.02em] whitespace-nowrap text-app-text',
  content: 'flex min-h-0 flex-1 flex-row overflow-hidden',
  panelSlide:
    'w-0 shrink-0 overflow-hidden transition-[width] duration-[280ms] ease-[cubic-bezier(0.22,1,0.36,1)]',
  panelSlideOpen: 'w-[clamp(320px,26vw,400px)] max-[720px]:w-[min(86vw,360px)]',
  status: 'grid min-h-screen place-items-center bg-[#f7f8fb] text-[#647084]',
  error:
    'absolute top-4 left-1/2 max-w-[min(38rem,calc(100%-2rem))] -translate-x-1/2 rounded-lg border border-[#f2bcc5] bg-[#fff0f2] px-3.5 py-2.5 text-[#8f1d2c]',
  modalBackdrop:
    'fixed inset-0 z-[200] grid animate-fade-in place-items-center bg-[rgb(10_15_28/62%)] backdrop-blur-[3px]',
  modalPanel:
    'relative h-[min(88vh,820px)] w-[min(92vw,1280px)] animate-slide-up overflow-hidden rounded-xl border border-[rgb(255_255_255/10%)] bg-[#0d1117] shadow-[0_24px_64px_rgb(0_0_0/55%)] max-[720px]:h-[100dvh] max-[720px]:w-screen max-[720px]:rounded-none',
  modalClose:
    'absolute top-3 right-3.5 z-10 grid h-8 w-8 cursor-pointer place-items-center rounded-md border-0 bg-[rgb(255_255_255/8%)] text-[0.875rem] text-[rgb(255_255_255/65%)] transition-colors hover:bg-[rgb(255_255_255/16%)] hover:text-white',
  modalLoading: 'grid h-full place-items-center text-[0.875rem] text-[rgb(255_255_255/45%)]',
  toast:
    'pointer-events-none fixed right-6 bottom-6 z-[300] animate-toast rounded-lg border border-[#f5c97a] bg-[#fef3e2] px-3.5 py-2 text-[0.8125rem] font-medium text-[#5a3e1b] shadow-[0_4px_16px_rgb(15_23_42/12%)] max-[720px]:right-4 max-[720px]:bottom-4'
}

export default function ProjectionMapPage() {
  const [selectedScenes, setSelectedScenes] = useState<ProjectionMapPoint[]>([])
  const [activeScene, setActiveScene] = useState<string | null>(null)
  const [toast, setToast] = useState<{ sceneName: string; availability: SceneAvailability } | null>(
    null
  )
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const { points, loading, error } = useProjectionMapData()

  const handleGlyphClick = useCallback(async (scene: ProjectionMapPoint) => {
    const availability = await sceneAvailabilityProbe.check(scene)
    if (availability === 'available') {
      setActiveScene(scene.scene_name)
    } else {
      if (toastTimer.current) clearTimeout(toastTimer.current)
      setToast({ sceneName: scene.scene_name, availability })
      toastTimer.current = setTimeout(() => setToast(null), 3500)
    }
  }, [])

  const handleSelectionChange = useCallback((scenes: ProjectionMapPoint[]) => {
    setSelectedScenes(scenes)
  }, [])

  useEffect(
    () => () => {
      if (toastTimer.current) clearTimeout(toastTimer.current)
    },
    []
  )

  return (
    <main className={cls.page}>
      <header className={cls.header}>
        <span className={cls.headerTitle}>自动驾驶场景可视分析</span>
      </header>

      <div className={cls.content}>
        {/* Left: selected scene list — slides in when scenes are selected */}
        <div className={`${cls.panelSlide} ${selectedScenes.length > 0 ? cls.panelSlideOpen : ''}`}>
          <SceneListPanel
            scenes={selectedScenes}
            visible={selectedScenes.length > 0}
            onClear={() => setSelectedScenes([])}
          />
        </div>

        {/* Right: projection map */}
        {loading ? (
          <div className={cls.status}>Loading projection data...</div>
        ) : (
          <ProjectionMapView
            points={points}
            selectedScenes={selectedScenes}
            onGlyphClick={handleGlyphClick}
            onSelectionChange={handleSelectionChange}
          />
        )}
      </div>

      {error && <div className={cls.error}>{error}</div>}

      {/* 3D scene modal */}
      {activeScene && (
        <div className={cls.modalBackdrop} onClick={() => setActiveScene(null)}>
          <div className={cls.modalPanel} onClick={e => e.stopPropagation()}>
            <button
              className={cls.modalClose}
              type='button'
              aria-label='Close scene viewer'
              onClick={() => setActiveScene(null)}
            >
              ✕
            </button>
            <Suspense fallback={<div className={cls.modalLoading}>Loading scene…</div>}>
              <SceneViewer sceneUrl={`/data/scenes/${activeScene}/`} />
            </Suspense>
          </div>
        </div>
      )}

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
