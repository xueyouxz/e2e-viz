import { useCallback, useMemo, useRef, useState } from 'react'
import type { CSSProperties, KeyboardEvent, PointerEvent } from 'react'
import { Pause, Play } from 'lucide-react'
import { useSceneStore, useSceneStoreApi } from '../context'
import { findNearestFrameIndex } from './timeManager'
import './Playback.css'

type PlaybackStyle = CSSProperties & {
  '--playback-progress-position': string
  '--playback-progress-scale': number
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value))
}

function getStartTime(timestamps: ArrayLike<number>): number {
  return timestamps[0] ?? 0
}

function getEndTime(timestamps: ArrayLike<number>): number {
  return timestamps[timestamps.length - 1] ?? getStartTime(timestamps)
}

function getDuration(timestamps: ArrayLike<number>): number {
  return Math.max(Number.EPSILON, getEndTime(timestamps) - getStartTime(timestamps))
}

function getFrameTime(frameIndex: number, timestamps: ArrayLike<number>): number {
  const safeFrameIndex = clamp(Math.round(frameIndex), 0, Math.max(0, timestamps.length - 1))
  return timestamps[safeFrameIndex] ?? getStartTime(timestamps)
}

function getProgress(frameIndex: number, timestamps: ArrayLike<number>): number {
  const elapsed = getFrameTime(frameIndex, timestamps) - getStartTime(timestamps)
  return clamp(elapsed / getDuration(timestamps), 0, 1)
}

function formatTime(seconds: number): string {
  const safeSeconds = Math.max(0, seconds)
  return `${String(Math.floor(safeSeconds / 60)).padStart(2, '0')}:${String(
    Math.floor(safeSeconds % 60)
  ).padStart(2, '0')}`
}

function formatPreciseTime(seconds: number): string {
  const totalTenths = Math.max(0, Math.round(seconds * 10))
  const minutes = Math.floor(totalTenths / 600)
  const secondsWithinMinute = (totalTenths % 600) / 10
  return `${String(minutes).padStart(2, '0')}:${secondsWithinMinute.toFixed(1).padStart(4, '0')}`
}

function Ruler({ timestamps }: { timestamps: ArrayLike<number> }) {
  const duration = getDuration(timestamps)
  const ticks = useMemo(() => {
    const result: number[] = []
    for (let elapsed = 0; elapsed <= duration + 1e-9; elapsed += 2) {
      result.push(Number(elapsed.toFixed(6)))
    }
    const lastTick = result[result.length - 1] ?? 0
    if (duration - lastTick > 0.5 && formatTime(duration) !== formatTime(lastTick)) {
      result.push(duration)
    }
    return result
  }, [duration])

  return (
    <div className='scene-playback__ruler'>
      {ticks.map(tick => (
        <div
          key={tick}
          className='scene-playback__tick'
          style={{ left: `${(tick / duration) * 100}%` }}
        >
          <span className='scene-playback__tick-label'>{formatTime(tick)}</span>
          <div className='scene-playback__tick-line' />
        </div>
      ))}
    </div>
  )
}

export function Playback() {
  const store = useSceneStoreApi()
  const timestamps = useSceneStore(state => state.timestamps)
  const displayedFrameIndex = useSceneStore(state => state.displayedFrameIndex)
  const bufferEndFrame = useSceneStore(state => state.bufferEndFrame)
  const isPlaying = useSceneStore(state => state.isPlaying)
  const [dragFrameIndex, setDragFrameIndex] = useState<number | null>(null)
  const dragFrameRef = useRef<number | null>(null)
  const trackRef = useRef<HTMLDivElement | null>(null)

  const getPointerFrame = useCallback(
    (clientX: number): number | null => {
      const track = trackRef.current
      if (!track || !timestamps || timestamps.length === 0) return null
      const bounds = track.getBoundingClientRect()
      if (bounds.width <= 0) return null
      const ratio = clamp((clientX - bounds.left) / bounds.width, 0, 1)
      const targetTime = getStartTime(timestamps) + ratio * getDuration(timestamps)
      return findNearestFrameIndex(timestamps, targetTime)
    },
    [timestamps]
  )

  const updateDragFrame = useCallback(
    (clientX: number): number | null => {
      const frameIndex = getPointerFrame(clientX)
      if (frameIndex === null) return null
      dragFrameRef.current = frameIndex
      setDragFrameIndex(frameIndex)
      return frameIndex
    },
    [getPointerFrame]
  )

  const handlePointerDown = (event: PointerEvent<HTMLDivElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId)
    updateDragFrame(event.clientX)
  }

  const handlePointerUp = (event: PointerEvent<HTMLDivElement>) => {
    if (dragFrameRef.current === null) return
    const targetFrameIndex = updateDragFrame(event.clientX) ?? dragFrameRef.current
    dragFrameRef.current = null
    setDragFrameIndex(null)
    store.getState().requestFrame(targetFrameIndex)
  }

  const cancelDrag = () => {
    dragFrameRef.current = null
    setDragFrameIndex(null)
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const state = store.getState()
    if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') {
      state.requestFrame(state.requestedFrameIndex - 1)
      event.preventDefault()
    } else if (event.key === 'ArrowRight' || event.key === 'ArrowUp') {
      state.requestFrame(state.requestedFrameIndex + 1)
      event.preventDefault()
    } else if (event.key === ' ') {
      if (state.isPlaying) state.pause()
      else state.play()
      event.preventDefault()
    }
  }

  if (!timestamps || timestamps.length === 0) return null

  const shownFrameIndex = dragFrameIndex ?? displayedFrameIndex
  const shownTime = getFrameTime(shownFrameIndex, timestamps) - getStartTime(timestamps)
  const shownTimeLabel = formatPreciseTime(shownTime)
  const progress = getProgress(shownFrameIndex, timestamps)
  const displayedProgress = getProgress(displayedFrameIndex, timestamps)
  const bufferEndProgress = getProgress(bufferEndFrame, timestamps)
  const hasBufferedFrames = bufferEndFrame > displayedFrameIndex
  const style: PlaybackStyle = {
    '--playback-progress-position': `${progress * 100}%`,
    '--playback-progress-scale': progress
  }

  return (
    <div
      className='scene-playback'
      role='region'
      aria-label='Playback controls'
      data-active={isPlaying || dragFrameIndex !== null}
      style={style}
    >
      <div className='scene-playback__controls'>
        <button
          className='scene-playback__button'
          onClick={isPlaying ? store.getState().pause : store.getState().play}
          aria-label={isPlaying ? 'Pause' : 'Play'}
          type='button'
        >
          {isPlaying ? (
            <Pause
              className='scene-playback__button-icon'
              aria-hidden='true'
              fill='currentColor'
              strokeWidth={0}
            />
          ) : (
            <Play
              className='scene-playback__button-icon'
              aria-hidden='true'
              fill='currentColor'
              strokeWidth={0}
            />
          )}
        </button>

        <div className='scene-playback__timeline'>
          <Ruler timestamps={timestamps} />
          <div
            ref={trackRef}
            className='scene-playback__slider'
            role='slider'
            tabIndex={0}
            aria-label='Scene frame'
            aria-valuemin={0}
            aria-valuemax={Math.max(0, timestamps.length - 1)}
            aria-valuenow={shownFrameIndex}
            aria-valuetext={shownTimeLabel}
            onKeyDown={handleKeyDown}
            onPointerDown={handlePointerDown}
            onPointerMove={event => {
              if (dragFrameRef.current !== null) updateDragFrame(event.clientX)
            }}
            onPointerUp={handlePointerUp}
            onPointerCancel={cancelDrag}
            onLostPointerCapture={cancelDrag}
          >
            <div className='scene-playback__track'>
              {hasBufferedFrames && (
                <div
                  className='scene-playback__buffer'
                  style={{
                    left: `${displayedProgress * 100}%`,
                    width: `${Math.max(0, bufferEndProgress - displayedProgress) * 100}%`
                  }}
                />
              )}
              <div className='scene-playback__progress' />
            </div>
            <div
              className='scene-playback__knob'
              data-tooltip-align={progress < 0.05 ? 'start' : progress > 0.95 ? 'end' : 'center'}
            >
              <span className='scene-playback__tooltip' role='tooltip'>
                {shownTimeLabel}
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
