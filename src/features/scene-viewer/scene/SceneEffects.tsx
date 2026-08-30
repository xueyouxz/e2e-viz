import { useEffect, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { useSceneStoreApi } from '../context'
import { advancePlaybackClock } from '../playback/PlaybackClock'

/**
 * Zero-output R3F component that wires all scene-level infrastructure effects.
 *
 * Shader precompilation: triggers gl.compile() one RAF after mount so all
 * renderers have attached their Three.js objects before compilation.
 *
 * Frame synchronization: drives frame-by-frame playback entirely inside the
 * R3F render loop. Reads all store state via getState() — zero React
 * subscriptions, zero re-renders.
 * Playback uses metadata timestamps, so irregular frame intervals and playback
 * speed share the same clock semantics as the timeline.
 */
export function SceneEffects() {
  // ── Shader precompilation (one-time on mount) ──────────────────────────────
  const { gl, scene, camera } = useThree()

  useEffect(() => {
    const raf = requestAnimationFrame(() => {
      gl.compile(scene, camera)
    })
    return () => cancelAnimationFrame(raf)
  }, [gl, scene, camera])

  // ── Frame synchronization (per-frame) ─────────────────────────────────────
  const store = useSceneStoreApi()
  const playbackTimeRef = useRef<number | null>(null)
  const lastObservedFrameRef = useRef(-1)

  useFrame((_state, delta) => {
    const { isPlaying, playbackSpeed, frameIndex, timestamps } = store.getState()
    if (!timestamps || timestamps.length === 0) {
      if (isPlaying) store.getState().pause()
      return
    }

    if (frameIndex !== lastObservedFrameRef.current || playbackTimeRef.current === null) {
      playbackTimeRef.current = timestamps[frameIndex] ?? timestamps[0] ?? 0
      lastObservedFrameRef.current = frameIndex
    }

    if (!isPlaying) return

    const result = advancePlaybackClock(playbackTimeRef.current, delta, playbackSpeed, timestamps)
    playbackTimeRef.current = result.timeSeconds

    if (result.frameIndex !== frameIndex) {
      store.getState().setFrameIndex(result.frameIndex)
      lastObservedFrameRef.current = result.frameIndex
    }
    if (result.isAtEnd) {
      const finalFrameIndex = timestamps.length - 1
      if (store.getState().frameIndex !== finalFrameIndex) {
        store.getState().setFrameIndex(finalFrameIndex)
      }
      lastObservedFrameRef.current = finalFrameIndex
      store.getState().pause()
    }
  })

  return null
}
