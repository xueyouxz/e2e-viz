import { useCallback, useMemo } from 'react'
import PlaybackTimeline from './PlaybackTimeline'
import type { BufferRange, TimeChangePayload } from './PlaybackTimeline'
import { useSceneStore } from '../context'

export function TimelineBar() {
  const rawTimestamps  = useSceneStore((s) => s.timestamps)
  const frameIndex     = useSceneStore((s) => s.frameIndex)
  const bufferEndFrame = useSceneStore((s) => s.bufferEndFrame)
  const isPlaying      = useSceneStore((s) => s.isPlaying)
  const play           = useSceneStore((s) => s.play)
  const pause          = useSceneStore((s) => s.pause)
  const setFrameIndex  = useSceneStore((s) => s.setFrameIndex)

  const timestamps = useMemo(
    () => (rawTimestamps ? Array.from(rawTimestamps) : []),
    [rawTimestamps],
  )

  const bufferRange = useMemo<BufferRange | undefined>(() => {
    if (timestamps.length === 0 || bufferEndFrame <= frameIndex) return undefined
    const endIdx = Math.min(bufferEndFrame, timestamps.length - 1)
    return {
      start: timestamps[frameIndex] ?? 0,
      end:   timestamps[endIdx] ?? 0,
    }
  }, [timestamps, frameIndex, bufferEndFrame])

  const handleTimeChange = useCallback(
    ({ frameIndex: nextFrameIndex }: TimeChangePayload) => {
      setFrameIndex(nextFrameIndex)
    },
    [setFrameIndex],
  )

  if (timestamps.length === 0) return null

  return (
    <PlaybackTimeline
      key={`${timestamps.length}-${timestamps[0] ?? 0}-${timestamps[timestamps.length - 1] ?? 0}`}
      timestamps={timestamps}
      frameIndex={frameIndex}
      isPlaying={isPlaying}
      onPlay={play}
      onPause={pause}
      onTimeChange={handleTimeChange}
      options={{ bufferRange }}
    />
  )
}
