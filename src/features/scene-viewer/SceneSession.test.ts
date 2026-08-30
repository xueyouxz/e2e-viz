import { describe, expect, it, vi } from 'vitest'
import { SceneSession } from './SceneSession'
import { createSceneStore } from './store/sceneStore'
import type {
  FrameCacheEntry,
  SceneRepository,
  SceneRepositoryInitResult
} from './data/SceneRepository'
import type { SceneMetadata } from './types'

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

const metadataResult: SceneRepositoryInitResult = {
  metadata,
  initialStreamState: {}
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(resolvePromise => {
    resolve = resolvePromise
  })
  return { promise, resolve }
}

function frameEntry(value: number): FrameCacheEntry {
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

function createRepository(loadFrame: (frameIndex: number) => Promise<FrameCacheEntry>) {
  const repository = {
    init: vi.fn(async () => metadataResult),
    loadFrame: vi.fn(loadFrame),
    prefetchAround: vi.fn(),
    getBufferEndFrame: vi.fn((frameIndex: number) => frameIndex),
    subscribeLoadingProgress: vi.fn(() => vi.fn()),
    subscribeCacheChanges: vi.fn(() => vi.fn()),
    destroy: vi.fn()
  }
  return repository as unknown as SceneRepository
}

describe('SceneSession', () => {
  it('resets scene data and applies only the latest requested frame', async () => {
    const store = createSceneStore()
    store.getState().setCameraMode('bev')
    store.getState().setPlaybackSpeed(2)
    const frames = new Map([
      [0, deferred<FrameCacheEntry>()],
      [1, deferred<FrameCacheEntry>()]
    ])
    const repository = createRepository(frameIndex => {
      const pendingFrame = frames.get(frameIndex)
      if (!pendingFrame) throw new Error(`Missing frame ${frameIndex}`)
      return pendingFrame.promise
    })
    const session = new SceneSession('/scene/', store, () => repository)

    await session.start()
    store.getState().setFrameIndex(1)
    frames.get(0)?.resolve(frameEntry(0))
    await Promise.resolve()
    expect(store.getState().streamState).toEqual({})

    frames.get(1)?.resolve(frameEntry(1))
    await vi.waitFor(() => expect(store.getState().streamState['/path']).toBeDefined())
    expect(store.getState()).toMatchObject({
      sceneName: 'new-scene',
      cameraMode: 'bev',
      playbackSpeed: 2,
      frameIndex: 1
    })
    expect(repository.prefetchAround).toHaveBeenCalledWith(1)
    session.destroy()
  })

  it('prevents pending frame work from committing after destroy', async () => {
    const store = createSceneStore()
    const pendingFrame = deferred<FrameCacheEntry>()
    const repository = createRepository(() => pendingFrame.promise)
    const session = new SceneSession('/scene/', store, () => repository)
    await session.start()

    session.destroy()
    pendingFrame.resolve(frameEntry(0))
    await Promise.resolve()

    expect(store.getState().streamState).toEqual({})
    expect(repository.destroy).toHaveBeenCalledTimes(1)
  })
})
