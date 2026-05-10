import { Suspense } from 'react'
import { useParams } from 'react-router-dom'
import SceneViewer from '@/features/scene-viewer/components/SceneViewer'
import { RouteLoading } from './RouteFallbacks'

export default function SceneViewerRoute() {
  const { sceneName = 'scene-0916' } = useParams<{ sceneName: string }>()
  const sceneUrl = `/data/scenes/${sceneName}/`
  return (
    <div style={{ width: '100%', height: '100dvh', overflow: 'hidden' }}>
      <Suspense fallback={<RouteLoading label="Loading scene…" variant="scene" />}>
        <SceneViewer sceneUrl={sceneUrl} />
      </Suspense>
    </div>
  )
}
