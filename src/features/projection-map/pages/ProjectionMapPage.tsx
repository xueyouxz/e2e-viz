import { Suspense, lazy, useCallback, useEffect, useRef, useState } from 'react'
import { ProjectionMapView } from '../components/ProjectionMapView'
import { SceneListPanel } from '../components/SceneListPanel'
import { useProjectionMapData } from '../hooks/useProjectionMapData'
import type { ProjectionMapPoint } from '../types/vectorMap.types'
import styles from './ProjectionMapPage.module.css'

const SceneViewer = lazy(() => import('@/features/scene-viewer/components/SceneViewer'))

async function probeScene(sceneName: string): Promise<boolean> {
  try {
    const res = await fetch(`/data/scenes/${sceneName}/message_index.json`)
    if (!res.ok) return false
    // Vite dev server returns text/html (SPA fallback) for missing paths even
    // with status 200 — check Content-Type to distinguish real JSON from that.
    return (res.headers.get('content-type') ?? '').includes('json')
  } catch {
    return false
  }
}

export default function ProjectionMapPage() {
  const [selectedScenes, setSelectedScenes] = useState<ProjectionMapPoint[]>([])
  const [activeScene, setActiveScene]     = useState<string | null>(null)
  const [toast, setToast]                 = useState<string | null>(null)
  const toastTimer                        = useRef<ReturnType<typeof setTimeout> | null>(null)

  const { points, splitCounts, loading, error } = useProjectionMapData()

  const handleGlyphClick = useCallback(async (sceneName: string) => {
    const exists = await probeScene(sceneName)
    if (exists) {
      setActiveScene(sceneName)
    } else {
      if (toastTimer.current) clearTimeout(toastTimer.current)
      setToast(sceneName)
      toastTimer.current = setTimeout(() => setToast(null), 3500)
    }
  }, [])

  const handleSelectionChange = useCallback((scenes: ProjectionMapPoint[]) => {
    setSelectedScenes(scenes)
  }, [])


  useEffect(() => () => { if (toastTimer.current) clearTimeout(toastTimer.current) }, [])

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <span className={styles.headerTitle}>自动驾驶场景可视分析</span>
        {!loading && (
          <div className={styles.headerMeta}>
            <span>{`Train ${splitCounts.train}`}</span>
            <span>{`Validation ${splitCounts.val}`}</span>
          </div>
        )}
      </header>

      <div className={styles.content}>
        {/* Left: selected scene list */}
        <SceneListPanel
          scenes={selectedScenes}
          onClear={() => setSelectedScenes([])}
        />

        {/* Right: projection map */}
        {loading ? (
          <div className={styles.status}>Loading projection data...</div>
        ) : (
          <ProjectionMapView
            points={points}
            selectedScenes={selectedScenes}
            onGlyphClick={handleGlyphClick}
            onSelectionChange={handleSelectionChange}
          />
        )}
      </div>

      {error && <div className={styles.error}>{error}</div>}

      {/* 3D scene modal */}
      {activeScene && (
        <div className={styles.modalBackdrop} onClick={() => setActiveScene(null)}>
          <div className={styles.modalPanel} onClick={e => e.stopPropagation()}>
            <button
              className={styles.modalClose}
              type='button'
              aria-label='Close scene viewer'
              onClick={() => setActiveScene(null)}
            >
              ✕
            </button>
            <Suspense fallback={<div className={styles.modalLoading}>Loading scene…</div>}>
              <SceneViewer sceneUrl={`/data/scenes/${activeScene}/`} />
            </Suspense>
          </div>
        </div>
      )}

      {/* No-data toast */}
      {toast && (
        <div className={styles.toast} role='status'>
          {`no ${toast} data`}
        </div>
      )}
    </main>
  )
}
