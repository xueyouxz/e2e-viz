import { render } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { PointRenderer } from './PointRenderer'

const { sceneState } = vi.hoisted(() => ({
  sceneState: {
    streamsMeta: {
      lidar: { type: 'point' as const, coordinate: 'world' as const, category: 'lidar' }
    },
    streamState: {},
    visibleStreams: {},
    frameIndex: 0,
    egoPose: null,
    statistics: null
  }
}))

vi.mock('../context', () => ({
  useSceneStore: (selector: (state: typeof sceneState) => unknown) => selector(sceneState),
  useSceneStoreApi: () => ({ getState: () => sceneState })
}))

describe('PointRenderer', () => {
  it('renders safely before the first point payload is available', () => {
    expect(() => render(<PointRenderer streamName='lidar' style={{}} />)).not.toThrow()
  })
})
