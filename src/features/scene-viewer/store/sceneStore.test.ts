import { describe, it, expect } from 'vitest'
import { createSceneStore } from './sceneStore'
import type { SceneMetadata } from '../types'

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
  it('creates a store with correct initial state', () => {
    const store = createSceneStore()
    const state = store.getState()
    expect(state.frameIndex).toBe(0)
    expect(state.isPlaying).toBe(false)
    expect(state.playbackSpeed).toBe(1)
    expect(state.cameraMode).toBe('free')
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

    it('resets frameIndex and isPlaying', () => {
      const store = createSceneStore()
      store.getState().setFrameIndex(5)
      store.getState().play()
      store.getState().setMetadata(META, {})
      expect(store.getState().frameIndex).toBe(0)
      expect(store.getState().isPlaying).toBe(false)
    })
  })

  describe('setFrame', () => {
    it('COMPLETE_STATE replaces streamState with staticStreamState + patches', () => {
      const store = createSceneStore()
      const points = new Float32Array([1, 2, 3])
      const initial = { '/lidar': { type: 'point' as const, points, intensity: null } }
      store.getState().setMetadata(META, initial)
      const newPoints = new Float32Array([4, 5, 6])
      store.getState().setFrame('COMPLETE_STATE', null, {
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

    it('INCREMENTAL merges patches into existing streamState', () => {
      const store = createSceneStore()
      store.getState().setMetadata(META, {})
      const points = new Float32Array([1, 2, 3])
      store.getState().setFrame('INCREMENTAL', null, {
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
      store.getState().setFrame('COMPLETE_STATE', ego, {})
      expect(store.getState().egoPose).toEqual(ego)
    })

    it('keeps existing egoPose when null is passed', () => {
      const store = createSceneStore()
      const ego = {
        translation: [1, 2, 3] as [number, number, number],
        rotation: [1, 0, 0, 0] as [number, number, number, number]
      }
      store.getState().setFrame('COMPLETE_STATE', ego, {})
      store.getState().setFrame('INCREMENTAL', null, {})
      expect(store.getState().egoPose).toEqual(ego)
    })
  })

  describe('setFrameIndex', () => {
    it('sets frameIndex', () => {
      const store = createSceneStore()
      store.getState().setFrameIndex(7)
      expect(store.getState().frameIndex).toBe(7)
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
      store.getState().setFrameIndex(9) // totalFrames - 1
      store.getState().play()
      expect(store.getState().frameIndex).toBe(0)
    })

    it('play keeps current frameIndex if not at end', () => {
      const store = createSceneStore()
      store.getState().setMetadata(META, {})
      store.getState().setFrameIndex(5)
      store.getState().play()
      expect(store.getState().frameIndex).toBe(5)
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
