import { isRouteErrorResponse, useRouteError } from 'react-router-dom'
import styles from './RouteFallbacks.module.css'

interface RouteLoadingProps {
  label?: string
  variant?: 'page' | 'scene'
}

export function RouteLoading({ label = 'Loading…', variant = 'page' }: RouteLoadingProps) {
  return (
    <div className={variant === 'scene' ? styles.sceneState : styles.routeState}>
      <div className={styles.statePanel}>
        <div className={styles.spinner} />
        <div className={styles.message}>{label}</div>
      </div>
    </div>
  )
}

export function RouteErrorBoundary() {
  const error = useRouteError()
  const message = isRouteErrorResponse(error)
    ? `${error.status} ${error.statusText}`
    : error instanceof Error
      ? error.message
      : 'Unexpected route error'

  return (
    <div className={styles.routeState}>
      <div className={styles.statePanel}>
        <div className={styles.title}>Unable to load this view</div>
        <div className={styles.message}>{message}</div>
      </div>
    </div>
  )
}
