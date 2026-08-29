import type { ReactNode } from 'react'
import { act, render, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { SceneCtx } from '../context'
import { createSceneStore } from '../store/sceneStore'
import { useFrameData } from './useFrameData'
import type { FrameCacheEntry, SceneDataManager } from '../data/SceneDataManager'
import type { SceneStore } from '../store/sceneStore'

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(resolvePromise => {
    resolve = resolvePromise
  })
  return { promise, resolve }
}

function entry(value: number): FrameCacheEntry {
  return {
    updateType: 'COMPLETE_STATE',
    egoPose: null,
    patches: {
      '/path': {
        type: 'polyline',
        vertices: new Float32Array([value, 0, 0, value + 1, 0, 0]),
        offsets: new Uint32Array([0, 2]),
        count: 1
      }
    },
    imageUrls: []
  }
}

function createManager(loadFrame: (frameIndex: number) => Promise<FrameCacheEntry>) {
  return {
    onCacheUpdate: undefined,
    getBufferEndFrame: vi.fn((frameIndex: number) => frameIndex),
    loadFrame: vi.fn(loadFrame),
    prefetch: vi.fn()
  } as unknown as SceneDataManager
}

function FrameDataProbe() {
  useFrameData()
  return null
}

function Provider({
  store,
  manager,
  children
}: {
  store: SceneStore
  manager: SceneDataManager
  children: ReactNode
}) {
  return <SceneCtx.Provider value={{ store, dataManager: manager }}>{children}</SceneCtx.Provider>
}

describe('useFrameData', () => {
  it('ignores an old scene result after the manager changes', async () => {
    const store = createSceneStore()
    const oldFrame = deferred<FrameCacheEntry>()
    const newFrame = deferred<FrameCacheEntry>()
    const oldManager = createManager(() => oldFrame.promise)
    const newManager = createManager(() => newFrame.promise)
    const view = render(
      <Provider store={store} manager={oldManager}>
        <FrameDataProbe />
      </Provider>
    )

    await waitFor(() => expect(oldManager.loadFrame).toHaveBeenCalledWith(0))
    view.rerender(
      <Provider store={store} manager={newManager}>
        <FrameDataProbe />
      </Provider>
    )
    await waitFor(() => expect(newManager.loadFrame).toHaveBeenCalledWith(0))

    await act(async () => oldFrame.resolve(entry(1)))
    expect(store.getState().streamState).toEqual({})

    await act(async () => newFrame.resolve(entry(2)))
    expect(store.getState().streamState['/path']).toMatchObject({ type: 'polyline' })
  })
})
