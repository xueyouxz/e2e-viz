import { Suspense } from 'react'
import { useParams } from 'react-router-dom'
import { Loading, SceneViewer } from '@/features/scene-viewer'

export default function SceneViewerRoute() {
  const { sceneName } = useParams<{ sceneName: string }>()

  if (!sceneName) {
    throw new Error('Scene name is required')
  }

  const sceneUrl = `/data/scenes/${sceneName}/`
  return (
    <div className='relative h-[100dvh] w-full overflow-hidden'>
      <Suspense fallback={<Loading />}>
        <SceneViewer sceneUrl={sceneUrl} />
      </Suspense>
    </div>
  )
}
