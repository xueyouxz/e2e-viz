import { Suspense, lazy } from 'react'
import { Navigate, createBrowserRouter } from 'react-router-dom'
import { Loading } from '@/features/scene-viewer/Loading'
import { RouteErrorBoundary, RouteLoading, RouteNotFound } from './RouteFallbacks'

const ProjectionMapPage = lazy(() => import('@/features/projection-map'))
const SceneViewerRoute = lazy(() => import('./SceneViewerRoute'))

export const router = createBrowserRouter([
  {
    errorElement: <RouteErrorBoundary />,
    children: [
      {
        path: '/',
        element: <Navigate replace to='/projection-map' />
      },
      {
        path: '/projection-map',
        element: (
          <Suspense fallback={<RouteLoading />}>
            <ProjectionMapPage />
          </Suspense>
        )
      },
      {
        path: '/scenes/:sceneName',
        element: (
          <Suspense
            fallback={
              <div className='relative min-h-[100dvh] bg-app-surface-raised'>
                <Loading />
              </div>
            }
          >
            <SceneViewerRoute />
          </Suspense>
        )
      },
      {
        path: '*',
        element: <RouteNotFound />
      }
    ]
  }
])
