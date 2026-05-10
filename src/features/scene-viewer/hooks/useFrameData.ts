import { useEffect, useRef } from 'react'
import { useSceneCtx, useSceneStore, useSceneStoreApi } from '../context'

export function useFrameData(): void {
  const { dataManager } = useSceneCtx()
  const store = useSceneStoreApi()
  const frameIndex = useSceneStore((s) => s.frameIndex)
  const setFrame = useSceneStore((s) => s.setFrame)
  const pause = useSceneStore((s) => s.pause)
  const setBufferEndFrame = useSceneStore((s) => s.setBufferEndFrame)

  const lastLoadedRef = useRef(-1)

  useEffect(() => {
    dataManager.onCacheUpdate = () => {
      const { frameIndex: currentFrame } = store.getState()
      setBufferEndFrame(dataManager.getBufferEndFrame(currentFrame))
    }
    return () => {
      dataManager.onCacheUpdate = undefined
    }
  }, [dataManager, store, setBufferEndFrame])

  useEffect(() => {
    // Reset loaded tracker when dataManager instance changes (new scene)
    lastLoadedRef.current = -1
  }, [dataManager])

  useEffect(() => {
    if (lastLoadedRef.current === frameIndex) return
    lastLoadedRef.current = frameIndex

    const requested = frameIndex
    let cancelled = false

    dataManager
      .loadFrame(requested)
      .then((entry) => {
        if (cancelled) return
        if (store.getState().frameIndex !== requested) return
        setFrame(entry.updateType, entry.egoPose, entry.patches)
        dataManager.prefetch(requested)
      })
      .catch((err: unknown) => {
        if (cancelled) return
        if (store.getState().frameIndex !== requested) return
        console.warn(`[useFrameData] Failed to load frame ${requested}:`, err)
        pause()
      })

    return () => {
      cancelled = true
    }
  }, [frameIndex, dataManager, store, setFrame, pause])
}
