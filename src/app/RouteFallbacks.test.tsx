import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { RouteLoading } from './RouteFallbacks'

// RouteErrorBoundary calls useRouteError() which requires a router context —
// unit-test only RouteLoading here; error boundary behavior is covered by E2E.
vi.mock('./RouteFallbacks.module.css', () => ({
  default: {
    routeState: 'routeState',
    sceneState: 'sceneState',
    statePanel: 'statePanel',
    spinner: 'spinner',
    message: 'message',
  }
}))

describe('RouteLoading', () => {
  it('renders default label', () => {
    render(<RouteLoading />)
    expect(screen.getByText('Loading…')).toBeDefined()
  })

  it('renders custom label', () => {
    render(<RouteLoading label="Fetching scene…" />)
    expect(screen.getByText('Fetching scene…')).toBeDefined()
  })
})
