import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { SceneCtx } from '../context'
import { createSceneStore } from '../store/sceneStore'
import { PlaybackTimeline } from './PlaybackTimeline'
import type { SceneMetadata } from '../types'

class ResizeObserverMock {
  observe() {}
  disconnect() {}
}

const metadata: SceneMetadata = {
  streams: {},
  cameras: {},
  totalFrames: 3,
  logInfo: { start_time: 0, end_time: 1 },
  timestamps: new Float32Array([0, 0.5, 1]),
  statistics: null,
  sceneName: 'playback',
  sceneDescription: ''
}

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', ResizeObserverMock)
})

describe('PlaybackTimeline', () => {
  it('delegates play, pause, and seek to the scene store without starting a RAF', () => {
    const store = createSceneStore()
    store.getState().setMetadata(metadata, {})
    const requestAnimationFrame = vi.spyOn(window, 'requestAnimationFrame')
    render(
      <SceneCtx.Provider value={{ store }}>
        <PlaybackTimeline />
      </SceneCtx.Provider>
    )

    fireEvent.click(screen.getByRole('button', { name: 'Play' }))
    expect(store.getState().isPlaying).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'Pause' }))
    expect(store.getState().isPlaying).toBe(false)

    fireEvent.keyDown(screen.getByRole('region', { name: 'Playback controls' }), {
      key: 'ArrowRight'
    })
    expect(store.getState().frameIndex).toBe(1)
    expect(requestAnimationFrame).not.toHaveBeenCalled()
  })
})
