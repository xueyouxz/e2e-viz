import { Suspense } from 'react'
import { useParams } from 'react-router-dom'
import SceneViewer from '@/features/scene-viewer/SceneViewer'
import { RouteLoading } from './RouteFallbacks'
import styles from './SceneViewerRoute.module.css'

export default function SceneViewerRoute() {
  const { sceneName } = useParams<{ sceneName: string }>()
  const sceneUrl = `/data/scenes/${sceneName!}/`
  return (
    <div className={styles.viewport}>
      <Suspense fallback={<RouteLoading label='Loading scene…' variant='scene' />}>
        <SceneViewer sceneUrl={sceneUrl} />
      </Suspense>
    </div>
  )
}
