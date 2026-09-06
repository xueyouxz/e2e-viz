import { describe, it, expect } from 'vitest'
import { createSceneStore } from '../sceneStore'
import type { SceneMetadata } from '../../types'

const META: SceneMetadata = {
  streams: {
    '/lidar': { type: 'point', coordinate: 'ego', category: 'lidar' },
    '/boxes': { type: 'cuboid', coordinate: 'world', category: 'objects' },
    '/ego_pose': { type: 'pose', coordinate: 'world', category: 'ego' }
  },
  cameras: {},
  totalFrames: 10,
  logInfo: { start_time: 0, end_time: 100 },
  timestamps: null,
  statistics: null,
  sceneName: 'test_scene',
  sceneDescription: 'A test scene'
}

describe('createSceneStore', () => {
  it('creates isolated state for separate viewer instances', () => {
    const first = createSceneStore()
    const second = createSceneStore()

    first.getState().setMetadata(META, {})
    first.getState().requestFrame(7)
    first.getState().setCameraMode('bev')

    expect(second.getState().requestedFrameIndex).toBe(0)
    expect(second.getState().cameraMode).toBe('follow')
  })

  it('creates a store with correct initial state', () => {
    const store = createSceneStore()
    const state = store.getState()
    expect(state.displayedFrameIndex).toBe(0)
    expect(state.requestedFrameIndex).toBe(0)
    expect(state.isPlaying).toBe(false)
    expect(state.playbackSpeed).toBe(1)
    expect(state.cameraMode).toBe('follow')
    expect(state.selectedTrackId).toBeNull()
    expect(state.totalFrames).toBe(0)
  })

  describe('setMetadata', () => {
    it('sets scene info from metadata', () => {
      const store = createSceneStore()
      store.getState().setMetadata(META, {})
      const s = store.getState()
      expect(s.sceneName).toBe('test_scene')
      expect(s.sceneDescription).toBe('A test scene')
      expect(s.totalFrames).toBe(10)
    })

    it('hides /lidar by default', () => {
      const store = createSceneStore()
      store.getState().setMetadata(META, {})
      expect(store.getState().visibleStreams['/lidar']).toBe(false)
    })

    it('shows non-hidden streams', () => {
      const store = createSceneStore()
      store.getState().setMetadata(META, {})
      expect(store.getState().visibleStreams['/boxes']).toBe(true)
    })

    it('excludes pose streams from visibleStreams', () => {
      const store = createSceneStore()
      store.getState().setMetadata(META, {})
      expect('/ego_pose' in store.getState().visibleStreams).toBe(false)
    })

    it('resets playback frames and isPlaying', () => {
      const store = createSceneStore()
      store.getState().setMetadata(META, {})
      store.getState().requestFrame(5)
      store.getState().commitFrame(5, 'COMPLETE_STATE', null, {})
      store.getState().play()
      store.getState().setMetadata(META, {})
      expect(store.getState().displayedFrameIndex).toBe(0)
      expect(store.getState().requestedFrameIndex).toBe(0)
      expect(store.getState().isPlaying).toBe(false)
    })
  })

  it('resets scene data while preserving viewer preferences', () => {
    const store = createSceneStore()
    store.getState().setMetadata(META, {})
    store.getState().requestFrame(5)
    store.getState().commitFrame(5, 'COMPLETE_STATE', null, {})
    store.getState().setCameraMode('bev')
    store.getState().setPlaybackSpeed(2)

    store.getState().resetSceneData()

    expect(store.getState()).toMatchObject({
      streamsMeta: {},
      totalFrames: 0,
      displayedFrameIndex: 0,
      requestedFrameIndex: 0,
      isPlaying: false,
      cameraMode: 'bev',
      playbackSpeed: 2
    })
  })

  describe('commitFrame', () => {
    it('COMPLETE_STATE replaces streamState with staticStreamState + patches', () => {
      const store = createSceneStore()
      const points = new Float32Array([1, 2, 3])
      const initial = { '/lidar': { type: 'point' as const, points, intensity: null } }
      store.getState().setMetadata(META, initial)
      const newPoints = new Float32Array([4, 5, 6])
      store.getState().commitFrame(1, 'COMPLETE_STATE', null, {
        '/boxes': {
          type: 'cuboid' as const,
          centers: newPoints,
          sizes: newPoints,
          rotations: newPoints,
          classIds: new Uint32Array([1]),
          trackIds: null,
          scores: null,
          count: 1
        }
      })
      expect(store.getState().streamState['/lidar']).toBeDefined()
      expect(store.getState().streamState['/boxes']).toBeDefined()
    })

    it('COMPLETE_STATE removes dynamic streams omitted from the new frame', () => {
      const store = createSceneStore()
      store.getState().setMetadata(META, {})
      store.getState().commitFrame(1, 'INCREMENTAL', null, {
        '/lidar': {
          type: 'point',
          points: new Float32Array([1, 2, 3]),
          intensity: null
        }
      })

      store.getState().commitFrame(2, 'COMPLETE_STATE', null, {})

      expect(store.getState().streamState['/lidar']).toBeUndefined()
    })

    it('INCREMENTAL merges patches into existing streamState', () => {
      const store = createSceneStore()
      store.getState().setMetadata(META, {})
      const points = new Float32Array([1, 2, 3])
      store.getState().commitFrame(1, 'INCREMENTAL', null, {
        '/lidar': { type: 'point' as const, points, intensity: null }
      })
      expect(store.getState().streamState['/lidar']).toBeDefined()
    })

    it('updates egoPose when provided', () => {
      const store = createSceneStore()
      const ego = {
        translation: [1, 2, 3] as [number, number, number],
        rotation: [1, 0, 0, 0] as [number, number, number, number]
      }
      store.getState().commitFrame(1, 'COMPLETE_STATE', ego, {})
      expect(store.getState().egoPose).toEqual(ego)
    })

    it('keeps existing egoPose when null is passed', () => {
      const store = createSceneStore()
      const ego = {
        translation: [1, 2, 3] as [number, number, number],
        rotation: [1, 0, 0, 0] as [number, number, number, number]
      }
      store.getState().commitFrame(1, 'COMPLETE_STATE', ego, {})
      store.getState().commitFrame(2, 'INCREMENTAL', null, {})
      expect(store.getState().egoPose).toEqual(ego)
    })

    it('commits the displayed frame and scene payload atomically', () => {
      const store = createSceneStore()
      store.getState().setMetadata(META, {})
      const snapshots: Array<{ frameIndex: number; hasLidar: boolean }> = []
      const unsubscribe = store.subscribe(state => {
        snapshots.push({
          frameIndex: state.displayedFrameIndex,
          hasLidar: state.streamState['/lidar'] !== undefined
        })
      })

      store.getState().commitFrame(3, 'COMPLETE_STATE', null, {
        '/lidar': {
          type: 'point',
          points: new Float32Array([1, 2, 3]),
          intensity: null
        }
      })

      expect(snapshots).toEqual([{ frameIndex: 3, hasLidar: true }])
      unsubscribe()
    })
  })

  describe('requestFrame', () => {
    it('sets and clamps requestedFrameIndex without changing the displayed frame', () => {
      const store = createSceneStore()
      store.getState().setMetadata(META, {})
      store.getState().requestFrame(20)
      expect(store.getState().requestedFrameIndex).toBe(9)
      expect(store.getState().displayedFrameIndex).toBe(0)
    })
  })

  describe('setBufferEndFrame', () => {
    it('sets bufferEndFrame', () => {
      const store = createSceneStore()
      store.getState().setBufferEndFrame(42)
      expect(store.getState().bufferEndFrame).toBe(42)
    })
  })

  describe('play / pause', () => {
    it('play sets isPlaying to true', () => {
      const store = createSceneStore()
      store.getState().play()
      expect(store.getState().isPlaying).toBe(true)
    })

    it('pause sets isPlaying to false', () => {
      const store = createSceneStore()
      store.getState().play()
      store.getState().pause()
      expect(store.getState().isPlaying).toBe(false)
    })

    it('play resets to frame 0 when at last frame', () => {
      const store = createSceneStore()
      store.getState().setMetadata(META, {})
      store.getState().requestFrame(9)
      store.getState().commitFrame(9, 'COMPLETE_STATE', null, {})
      store.getState().play()
      expect(store.getState().requestedFrameIndex).toBe(0)
      expect(store.getState().displayedFrameIndex).toBe(9)
    })

    it('play keeps the current request if the displayed frame is not at the end', () => {
      const store = createSceneStore()
      store.getState().setMetadata(META, {})
      store.getState().requestFrame(5)
      store.getState().commitFrame(5, 'COMPLETE_STATE', null, {})
      store.getState().play()
      expect(store.getState().requestedFrameIndex).toBe(5)
      expect(store.getState().displayedFrameIndex).toBe(5)
    })
  })

  describe('setPlaybackSpeed', () => {
    it('sets playbackSpeed', () => {
      const store = createSceneStore()
      store.getState().setPlaybackSpeed(2)
      expect(store.getState().playbackSpeed).toBe(2)
    })
  })

  describe('setCameraMode', () => {
    it('sets cameraMode', () => {
      const store = createSceneStore()
      store.getState().setCameraMode('bev')
      expect(store.getState().cameraMode).toBe('bev')
    })
  })

  describe('setSelectedTrackId', () => {
    it('sets selectedTrackId', () => {
      const store = createSceneStore()
      store.getState().setSelectedTrackId(99)
      expect(store.getState().selectedTrackId).toBe(99)
    })

    it('clears selectedTrackId to null', () => {
      const store = createSceneStore()
      store.getState().setSelectedTrackId(99)
      store.getState().setSelectedTrackId(null)
      expect(store.getState().selectedTrackId).toBeNull()
    })
  })

  describe('toggleStream', () => {
    it('toggles stream visibility', () => {
      const store = createSceneStore()
      store.getState().setMetadata(META, {})
      const before = store.getState().visibleStreams['/boxes']
      store.getState().toggleStream('/boxes')
      expect(store.getState().visibleStreams['/boxes']).toBe(!before)
    })

    it('toggles twice returns to original state', () => {
      const store = createSceneStore()
      store.getState().setMetadata(META, {})
      const original = store.getState().visibleStreams['/boxes']
      store.getState().toggleStream('/boxes')
      store.getState().toggleStream('/boxes')
      expect(store.getState().visibleStreams['/boxes']).toBe(original)
    })
  })
})
