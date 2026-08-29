import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import PlaybackTimeline from './PlaybackTimeline'

class ResizeObserverMock {
  observe() {}
  disconnect() {}
}

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', ResizeObserverMock)
})

describe('PlaybackTimeline controlled mode', () => {
  it('delegates controlled actions without starting its internal RAF', () => {
    const onPlay = vi.fn()
    const onPause = vi.fn()
    const onTimeChange = vi.fn()
    const requestAnimationFrame = vi.spyOn(window, 'requestAnimationFrame')
    const view = render(
      <PlaybackTimeline
        timestamps={[0, 0.5, 1]}
        frameIndex={1}
        isPlaying={false}
        onPlay={onPlay}
        onPause={onPause}
        onTimeChange={onTimeChange}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: 'Play' }))
    expect(onPlay).toHaveBeenCalledTimes(1)

    view.rerender(
      <PlaybackTimeline
        timestamps={[0, 0.5, 1]}
        frameIndex={1}
        isPlaying
        onPlay={onPlay}
        onPause={onPause}
        onTimeChange={onTimeChange}
      />
    )
    fireEvent.click(screen.getByRole('button', { name: 'Pause' }))
    expect(onPause).toHaveBeenCalledTimes(1)

    fireEvent.keyDown(screen.getByRole('region', { name: 'Playback controls' }), {
      key: 'ArrowRight'
    })

    expect(onTimeChange).toHaveBeenCalledWith({
      frameIndex: 2,
      timeSeconds: 1,
      source: 'keyboard'
    })
    expect(requestAnimationFrame).not.toHaveBeenCalled()
  })
})
