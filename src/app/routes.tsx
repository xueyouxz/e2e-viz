import { Suspense, lazy } from 'react'
import { createBrowserRouter } from 'react-router-dom'
import { RouteErrorBoundary, RouteLoading } from './RouteFallbacks'

const ProjectionMapPage = lazy(() => import('@/features/projection-map/pages/ProjectionMapPage'))
const SceneViewerRoute = lazy(() => import('./SceneViewerRoute'))

const projectionMapRouteElement = (
  <Suspense fallback={<RouteLoading />}>
    <ProjectionMapPage />
  </Suspense>
)

export const router = createBrowserRouter([
  {
    path: '/',
    errorElement: <RouteErrorBoundary />,
    element: projectionMapRouteElement
  },
  {
    path: '/projection-map',
    errorElement: <RouteErrorBoundary />,
    element: projectionMapRouteElement
  },
  {
    path: '/scenes/:sceneName',
    errorElement: <RouteErrorBoundary />,
    element: (
      <Suspense fallback={<RouteLoading />}>
        <SceneViewerRoute />
      </Suspense>
    )
  }
])
