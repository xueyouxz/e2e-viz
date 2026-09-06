import { describe, expect, it, vi } from 'vitest'
import { SceneManager } from '../SceneManager'
import { createSceneStore } from '../store/sceneStore'
import type { LoadedFrame, SceneLoader, SceneLoadResult } from '../data/SceneLoader'
import type { SceneMetadata } from '../types'

const metadata: SceneMetadata = {
  streams: {},
  cameras: {},
  totalFrames: 3,
  logInfo: { start_time: 0, end_time: 2 },
  timestamps: new Float32Array([0, 1, 2]),
  statistics: null,
  sceneName: 'new-scene',
  sceneDescription: ''
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(resolvePromise => {
    resolve = resolvePromise
  })
  return { promise, resolve }
}

function frameEntry(value: number): LoadedFrame {
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

function createLoader(loadFrame: (frameIndex: number) => Promise<LoadedFrame>) {
  const result: SceneLoadResult = {
    metadata,
    initialStreamState: {},
    initialFrame: frameEntry(0)
  }
  const loader = {
    init: vi.fn(async () => result),
    loadFrame: vi.fn(loadFrame),
    prefetchAround: vi.fn(),
    getBufferEndFrame: vi.fn((frameIndex: number) => frameIndex),
    subscribeCacheChanges: vi.fn(() => vi.fn()),
    destroy: vi.fn()
  }
  return loader as unknown as SceneLoader
}

describe('SceneManager', () => {
  it('fails startup and releases the loader when the initial scene cannot load', async () => {
    const store = createSceneStore()
    const loader = createLoader(async () => frameEntry(1))
    vi.mocked(loader.init).mockRejectedValueOnce(new Error('initial frame failed'))
    const manager = new SceneManager('/scene/', store, () => loader)

    await expect(manager.start()).rejects.toThrow('initial frame failed')
    expect(loader.destroy).toHaveBeenCalledTimes(1)
  })

  it('resets scene data and applies only the latest requested frame', async () => {
    const store = createSceneStore()
    store.getState().setCameraMode('bev')
    store.getState().setPlaybackSpeed(2)
    const frames = new Map([
      [1, deferred<LoadedFrame>()],
      [2, deferred<LoadedFrame>()]
    ])
    const loader = createLoader(frameIndex => {
      const pendingFrame = frames.get(frameIndex)
      if (!pendingFrame) throw new Error(`Missing frame ${frameIndex}`)
      return pendingFrame.promise
    })
    const manager = new SceneManager('/scene/', store, () => loader)

    await manager.start()
    store.getState().requestFrame(1)
    store.getState().requestFrame(2)
    expect(store.getState()).toMatchObject({
      displayedFrameIndex: 0,
      requestedFrameIndex: 2
    })
    frames.get(1)?.resolve(frameEntry(1))
    await Promise.resolve()
    expect((store.getState().streamState['/path'] as { vertices: Float32Array }).vertices[0]).toBe(
      0
    )

    frames.get(2)?.resolve(frameEntry(2))
    await vi.waitFor(() => {
      const path = store.getState().streamState['/path'] as { vertices: Float32Array }
      expect(path.vertices[0]).toBe(2)
    })
    expect(store.getState()).toMatchObject({
      sceneName: 'new-scene',
      cameraMode: 'bev',
      playbackSpeed: 2,
      displayedFrameIndex: 2,
      requestedFrameIndex: 2
    })
    expect(loader.prefetchAround).toHaveBeenCalledWith(2)
    manager.destroy()
  })

  it('prevents pending frame work from committing after destroy', async () => {
    const store = createSceneStore()
    const pendingFrame = deferred<LoadedFrame>()
    const loader = createLoader(() => pendingFrame.promise)
    const manager = new SceneManager('/scene/', store, () => loader)
    await manager.start()
    store.getState().requestFrame(1)

    manager.destroy()
    pendingFrame.resolve(frameEntry(1))
    await Promise.resolve()

    expect((store.getState().streamState['/path'] as { vertices: Float32Array }).vertices[0]).toBe(
      0
    )
    expect(loader.destroy).toHaveBeenCalledTimes(1)
  })
})
