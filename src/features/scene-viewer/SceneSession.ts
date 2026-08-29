import { SceneRepository } from './data/SceneRepository'
import type { SceneLoadingProgress } from './data/loadingProgress'
import type { FrameCacheEntry } from './data/SceneRepository'
import type { SceneStore } from './store/sceneStore'

type RepositoryFactory = (sceneUrl: string) => SceneRepository
type LoadingProgressListener = (progress: SceneLoadingProgress) => void

const INITIAL_LOADING_PROGRESS: SceneLoadingProgress = {
  phase: 'index',
  loadedBytes: 0,
  totalBytes: null
}

export class SceneSession {
  private readonly repository: SceneRepository
  private readonly loadingProgressListeners = new Set<LoadingProgressListener>()
  private loadingProgress = INITIAL_LOADING_PROGRESS
  private unsubscribeLoadingProgress: (() => void) | null = null
  private unsubscribeCacheChanges: (() => void) | null = null
  private unsubscribeStore: (() => void) | null = null
  private latestFrameRequestId = 0
  private isStarted = false
  private isDestroyed = false

  constructor(
    sceneUrl: string,
    private readonly store: SceneStore,
    repositoryFactory: RepositoryFactory = url => new SceneRepository(url)
  ) {
    this.repository = repositoryFactory(sceneUrl)
  }

  subscribeLoadingProgress(listener: LoadingProgressListener): () => void {
    this.loadingProgressListeners.add(listener)
    listener(this.loadingProgress)
    return () => this.loadingProgressListeners.delete(listener)
  }

  async start(): Promise<void> {
    if (this.isStarted) throw new Error('SceneSession already started')
    this.assertActive()
    this.isStarted = true
    this.store.getState().resetSceneData()

    this.unsubscribeLoadingProgress = this.repository.subscribeLoadingProgress(progress => {
      this.loadingProgress = progress
      for (const listener of this.loadingProgressListeners) listener(progress)
    })
    this.unsubscribeCacheChanges = this.repository.subscribeCacheChanges(() => {
      const frameIndex = this.store.getState().frameIndex
      this.store.getState().setBufferEndFrame(this.repository.getBufferEndFrame(frameIndex))
    })

    const { metadata, initialStreamState } = await this.repository.init()
    this.assertActive()
    this.store.getState().setMetadata(metadata, initialStreamState)

    this.unsubscribeStore = this.store.subscribe((state, previousState) => {
      if (state.frameIndex !== previousState.frameIndex) {
        void this.handleFrameIndexChange(state.frameIndex)
      }
    })
    void this.handleFrameIndexChange(this.store.getState().frameIndex)
  }

  destroy(): void {
    if (this.isDestroyed) return
    this.isDestroyed = true
    this.latestFrameRequestId++
    this.unsubscribeStore?.()
    this.unsubscribeStore = null
    this.unsubscribeCacheChanges?.()
    this.unsubscribeCacheChanges = null
    this.unsubscribeLoadingProgress?.()
    this.unsubscribeLoadingProgress = null
    this.repository.destroy()
    this.loadingProgressListeners.clear()
  }

  private async handleFrameIndexChange(requestedFrameIndex: number): Promise<void> {
    const requestId = ++this.latestFrameRequestId
    try {
      const entry = await this.repository.loadFrame(requestedFrameIndex)
      if (!this.isFrameRequestCurrent(requestId, requestedFrameIndex)) return
      this.applyLoadedFrame(requestedFrameIndex, entry)
    } catch (error) {
      if (!this.isFrameRequestCurrent(requestId, requestedFrameIndex)) return
      console.warn(`[SceneSession] Failed to load frame ${requestedFrameIndex}:`, error)
      this.store.getState().pause()
    }
  }

  private isFrameRequestCurrent(requestId: number, requestedFrameIndex: number): boolean {
    return (
      !this.isDestroyed &&
      requestId === this.latestFrameRequestId &&
      requestedFrameIndex === this.store.getState().frameIndex
    )
  }

  private applyLoadedFrame(frameIndex: number, entry: FrameCacheEntry): void {
    this.store.getState().setFrame(entry.updateType, entry.egoPose, entry.patches)
    this.repository.prefetchAround(frameIndex)
    this.store.getState().setBufferEndFrame(this.repository.getBufferEndFrame(frameIndex))
  }

  private assertActive(): void {
    if (this.isDestroyed) throw new Error('SceneSession destroyed')
  }
}
