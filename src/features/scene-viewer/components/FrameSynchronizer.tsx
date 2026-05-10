import { useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { useSceneStoreApi } from '../context'

/**
 * Drives frame-by-frame playback entirely inside the R3F render loop.
 *
 * Reads all store state via getState() — zero React subscriptions, zero re-renders.
 * nuScenes frame interval ≈ 0.2 s at 5 fps; playbackSpeed × 5 maps delta seconds to frame rate.
 */
export function FrameSynchronizer() {
  const store = useSceneStoreApi()
  const accRef = useRef(0)
  const lastFrameRef = useRef(-1)

  useFrame((_state, delta) => {
    const { isPlaying, playbackSpeed, frameIndex, totalFrames } = store.getState()

    // Reset accumulator on external seek (timeline scrub or initial load)
    if (frameIndex !== lastFrameRef.current) {
      accRef.current = frameIndex
      lastFrameRef.current = frameIndex
    }

    if (!isPlaying || totalFrames === 0) return

    accRef.current += delta * playbackSpeed * 5

    const nextFrame = Math.floor(accRef.current)
    if (nextFrame > frameIndex && nextFrame < totalFrames) {
      store.getState().setFrameIndex(nextFrame)
      lastFrameRef.current = nextFrame
    } else if (accRef.current >= totalFrames) {
      store.getState().pause()
      accRef.current = totalFrames - 1
      lastFrameRef.current = totalFrames - 1
    }
  })

  return null
}
