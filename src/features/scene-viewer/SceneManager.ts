import { SceneLoader, type LoadedFrame } from './data/SceneLoader'
import type { SceneStore } from './store/sceneStore'

type SceneLoaderFactory = (sceneUrl: string) => SceneLoader

export class SceneManager {
  private readonly loader: SceneLoader
  private readonly subscriptions: Array<() => void> = []
  private latestFrameRequestId = 0
  private isStarted = false
  private isDestroyed = false

  constructor(
    sceneUrl: string,
    private readonly store: SceneStore,
    loaderFactory: SceneLoaderFactory = url => new SceneLoader(url)
  ) {
    this.loader = loaderFactory(sceneUrl)
  }

  async start(): Promise<void> {
    if (this.isStarted) throw new Error('SceneManager already started')
    this.assertActive()
    this.isStarted = true
    this.store.getState().resetSceneData()

    try {
      this.subscriptions.push(
        this.loader.subscribeCacheChanges(() => {
          const frameIndex = this.store.getState().displayedFrameIndex
          this.store.getState().setBufferEndFrame(this.loader.getBufferEndFrame(frameIndex))
        })
      )

      const { metadata, initialStreamState, initialFrame } = await this.loader.init()
      this.assertActive()
      this.store.getState().setMetadata(metadata, initialStreamState)
      if (initialFrame) this.applyLoadedFrame(0, initialFrame)

      this.subscriptions.push(
        this.store.subscribe((state, previousState) => {
          if (state.requestedFrameIndex !== previousState.requestedFrameIndex) {
            void this.loadRequestedFrame(state.requestedFrameIndex)
          }
        })
      )
    } catch (error) {
      this.destroy()
      throw error
    }
  }

  destroy(): void {
    if (this.isDestroyed) return
    this.isDestroyed = true
    this.latestFrameRequestId++
    for (const unsubscribe of this.subscriptions.splice(0)) unsubscribe()
    this.loader.destroy()
  }

  private async loadRequestedFrame(requestedFrameIndex: number): Promise<void> {
    const requestId = ++this.latestFrameRequestId
    try {
      const entry = await this.loader.loadFrame(requestedFrameIndex)
      if (!this.isFrameRequestCurrent(requestId, requestedFrameIndex)) return
      this.applyLoadedFrame(requestedFrameIndex, entry)
    } catch (error) {
      if (!this.isFrameRequestCurrent(requestId, requestedFrameIndex)) return
      console.warn(`[SceneManager] Failed to load frame ${requestedFrameIndex}:`, error)
      this.store.getState().pause()
    }
  }

  private isFrameRequestCurrent(requestId: number, requestedFrameIndex: number): boolean {
    return (
      !this.isDestroyed &&
      requestId === this.latestFrameRequestId &&
      requestedFrameIndex === this.store.getState().requestedFrameIndex
    )
  }

  private applyLoadedFrame(frameIndex: number, entry: LoadedFrame): void {
    this.store.getState().commitFrame(frameIndex, entry.updateType, entry.egoPose, entry.patches)
    this.loader.prefetchAround(frameIndex)
    this.store.getState().setBufferEndFrame(this.loader.getBufferEndFrame(frameIndex))
  }

  private assertActive(): void {
    if (this.isDestroyed) throw new Error('SceneManager destroyed')
  }
}
