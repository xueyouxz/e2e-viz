import { isRouteErrorResponse, useRouteError } from 'react-router-dom'

const cls = {
  routeState:
    'flex min-h-[100dvh] items-center justify-center bg-app-surface-raised p-6 text-app-text-muted',
  sceneState:
    'flex h-full min-h-[220px] w-full items-center justify-center bg-app-surface-raised text-app-text-muted',
  statePanel: 'flex max-w-[420px] flex-col items-center gap-2.5 text-center',
  title: 'text-[0.9rem] font-bold text-app-text-strong',
  message: 'text-[0.78rem] leading-normal text-app-text-muted'
}

interface RouteLoadingProps {
  label?: string
  variant?: 'page' | 'scene'
}

export function RouteLoading({ label = 'Loading…', variant = 'page' }: RouteLoadingProps) {
  return (
    <div className={variant === 'scene' ? cls.sceneState : cls.routeState}>
      <div className={cls.statePanel}>
        <div className='h-6 w-6 animate-[spin_0.8s_linear_infinite] rounded-full border-2 border-app-border-btn border-t-accent' />
        <div className={cls.message}>{label}</div>
      </div>
    </div>
  )
}

export function RouteNotFound() {
  return (
    <div className={cls.routeState}>
      <div className={cls.statePanel}>
        <div className={cls.title}>Page not found</div>
        <div className={cls.message}>This URL doesn't match any known view.</div>
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
    <div className={cls.routeState}>
      <div className={cls.statePanel}>
        <div className={cls.title}>Unable to load this view</div>
        <div className={cls.message}>{message}</div>
      </div>
    </div>
  )
}
