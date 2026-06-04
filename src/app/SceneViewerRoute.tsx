import { Suspense } from 'react'
import { useParams } from 'react-router-dom'
import SceneViewer from '@/features/scene-viewer/SceneViewer'
import { RouteLoading } from './RouteFallbacks'

export default function SceneViewerRoute() {
  const { sceneName } = useParams<{ sceneName: string }>()
  const sceneUrl = `/data/scenes/${sceneName!}/`
  return (
    <div className='h-[100dvh] w-full overflow-hidden'>
      <Suspense fallback={<RouteLoading label='Loading scene…' variant='scene' />}>
        <SceneViewer sceneUrl={sceneUrl} />
      </Suspense>
    </div>
  )
}
