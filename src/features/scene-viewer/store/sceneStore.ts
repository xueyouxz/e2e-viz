import { create } from 'zustand'
import type { EgoPose, SceneMetadata, SceneStatistics, StreamMeta, StreamPayload } from '../types'

export type CameraMode = 'follow' | 'free' | 'bev'

const DEFAULT_HIDDEN = new Set([
  '/lidar',
  '/gt/objects/future_trajectories',
  '/gt/map/road_segment',
  '/gt/map/lane',
  '/gt/map/stop_line',
])

export interface SceneState {
  streamsMeta: Record<string, StreamMeta>
  cameras: SceneMetadata['cameras']
  totalFrames: number
  timestamps: Float32Array | null
  statistics: SceneStatistics | null
  sceneName: string
  sceneDescription: string

  staticStreamState: Record<string, StreamPayload>
  streamState: Record<string, StreamPayload>
  egoPose: EgoPose | null
  frameIndex: number
  isPlaying: boolean
  playbackSpeed: number

  cameraMode: CameraMode
  visibleStreams: Record<string, boolean>

  bufferEndFrame: number

  selectedTrackId: number | null
  setSelectedTrackId: (id: number | null) => void

  setMetadata: (meta: SceneMetadata, initialStreamState: Record<string, StreamPayload>) => void
  setFrame: (
    updateType: 'COMPLETE_STATE' | 'INCREMENTAL',
    egoPose: EgoPose | null,
    patches: Record<string, StreamPayload>,
  ) => void
  setFrameIndex: (i: number) => void
  setBufferEndFrame: (frame: number) => void
  play: () => void
  pause: () => void
  setPlaybackSpeed: (s: number) => void
  setCameraMode: (m: CameraMode) => void
  toggleStream: (name: string) => void
}

export function createSceneStore() {
  return create<SceneState>((set) => ({
    streamsMeta: {},
    cameras: {},
    totalFrames: 0,
    timestamps: null,
    statistics: null,
    sceneName: '',
    sceneDescription: '',
    staticStreamState: {},
    streamState: {},
    egoPose: null,
    frameIndex: 0,
    isPlaying: false,
    playbackSpeed: 1,
    bufferEndFrame: 0,
    cameraMode: 'free',
    visibleStreams: {},
    selectedTrackId: null,

    setMetadata: (meta, initialStreamState) =>
      set({
        streamsMeta: meta.streams,
        cameras: meta.cameras,
        totalFrames: meta.totalFrames,
        timestamps: meta.timestamps,
        statistics: meta.statistics,
        sceneName: meta.sceneName,
        sceneDescription: meta.sceneDescription,
        staticStreamState: initialStreamState,
        streamState: initialStreamState,
        visibleStreams: Object.fromEntries(
          Object.keys(meta.streams)
            .filter((k) => meta.streams[k].type !== 'pose')
            .map((k) => [k, !DEFAULT_HIDDEN.has(k)]),
        ),
        frameIndex: 0,
        isPlaying: false,
        selectedTrackId: null,
      }),

    setFrame: (updateType, egoPose, patches) =>
      set((state) => ({
        egoPose: egoPose ?? state.egoPose,
        streamState:
          updateType === 'COMPLETE_STATE'
            ? { ...state.staticStreamState, ...patches }
            : { ...state.streamState, ...patches },
      })),

    setFrameIndex: (i) => set({ frameIndex: i }),
    setBufferEndFrame: (frame) => set({ bufferEndFrame: frame }),
    play: () =>
      set((state) => ({
        isPlaying: true,
        frameIndex: state.frameIndex >= state.totalFrames - 1 ? 0 : state.frameIndex,
      })),
    pause: () => set({ isPlaying: false }),
    setPlaybackSpeed: (s) => set({ playbackSpeed: s }),
    setCameraMode: (m) => set({ cameraMode: m }),
    setSelectedTrackId: (id) => set({ selectedTrackId: id }),
    toggleStream: (name) =>
      set((state) => ({
        visibleStreams: { ...state.visibleStreams, [name]: !state.visibleStreams[name] },
      })),
  }))
}

export type SceneStore = ReturnType<typeof createSceneStore>
