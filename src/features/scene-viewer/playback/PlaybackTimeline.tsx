import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, KeyboardEvent, PointerEvent } from 'react'
import { Pause, Play } from 'lucide-react'
import { useSceneStore, useSceneStoreApi } from '../context'
import { svgTokens } from '../styleConfig'
import { findNearestFrameIndex } from './PlaybackClock'
import type { TimelineTokens } from '../styleConfig'

const cls = {
  root: 'box-border border-t border-t-[var(--timeline-border-color,#e2e8f0)] bg-[var(--timeline-background)] pt-2.5 pr-[var(--timeline-padding-right)] pb-[5px] pl-[var(--timeline-padding-left)] font-[Helvetica_Neue,Arial,sans-serif] text-[11px] text-[var(--timeline-text-primary)] outline-none select-none',
  controlRow: 'flex items-end gap-2.5',
  ruler: 'relative mb-[-3px] h-4',
  tick: 'pointer-events-none absolute bottom-0 flex flex-col items-center',
  tickLabel:
    'absolute bottom-[calc(100%+3px)] left-1/2 -translate-x-1/2 text-[11px] leading-none font-bold whitespace-nowrap tabular-nums text-[var(--timeline-tick-label-color)]',
  tickLine: 'h-2 w-px bg-[var(--timeline-tick-major-color)]',
  playButton:
    'flex h-7 w-7 shrink-0 translate-y-[3px] cursor-pointer items-center justify-center border-0 bg-transparent p-0 text-[var(--timeline-btn-color)] transition-colors hover:text-[var(--timeline-btn-hover-color)] focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-[var(--timeline-knob-border-active)]',
  playIcon: 'h-[17px] w-[17px]',
  trackColumn: 'min-w-0 flex-1',
  trackInteractive:
    'group relative h-[calc(var(--timeline-knob-size)+4px)] cursor-pointer touch-none',
  track:
    'absolute top-1/2 right-0 left-0 h-[var(--timeline-track-height)] -translate-y-1/2 rounded-[calc(var(--timeline-track-height)/2)] bg-[var(--timeline-track-bg)] transition-[height] duration-150 group-hover:h-[calc(var(--timeline-track-height)*3)]',
  bufferFill:
    'absolute top-0 left-0 z-[1] hidden h-full min-w-[2px] rounded-[calc(var(--timeline-track-height)/2)] bg-[var(--timeline-buffer-fill)]',
  progressFill:
    'absolute top-0 left-0 z-[2] h-full w-full origin-[left_center] rounded-[calc(var(--timeline-track-height)/2)] bg-[var(--timeline-track-fill)]',
  knob: 'pointer-events-none absolute top-1/2 left-0 z-[5] mt-[calc(var(--timeline-knob-size)/-2)] ml-[calc(var(--timeline-knob-size)/-2)] h-[var(--timeline-knob-size)] w-[var(--timeline-knob-size)] rounded-full border-2 bg-[var(--timeline-background)]'
}

type TimelineCssProperties = CSSProperties & Record<`--timeline-${string}`, string>

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value))
}

function getStartTime(timestamps: ArrayLike<number>): number {
  return timestamps[0] ?? 0
}

function getEndTime(timestamps: ArrayLike<number>): number {
  return timestamps[timestamps.length - 1] ?? getStartTime(timestamps)
}

function getDomain(timestamps: ArrayLike<number>): number {
  return Math.max(Number.EPSILON, getEndTime(timestamps) - getStartTime(timestamps))
}

function getFrameTime(frameIndex: number, timestamps: ArrayLike<number>): number {
  const safeFrameIndex = clamp(Math.round(frameIndex), 0, Math.max(0, timestamps.length - 1))
  return timestamps[safeFrameIndex] ?? getStartTime(timestamps)
}

function getPercent(timeSeconds: number, timestamps: ArrayLike<number>): number {
  return clamp(((timeSeconds - getStartTime(timestamps)) / getDomain(timestamps)) * 100, 0, 100)
}

function formatTime(seconds: number): string {
  const safeSeconds = Math.max(0, seconds)
  return `${String(Math.floor(safeSeconds / 60)).padStart(2, '0')}:${String(
    Math.floor(safeSeconds % 60)
  ).padStart(2, '0')}`
}

function buildTokenStyle(tokens: TimelineTokens): TimelineCssProperties {
  const padding =
    typeof tokens.padding === 'number'
      ? { left: tokens.padding, right: tokens.padding }
      : { left: tokens.padding.left ?? 14, right: tokens.padding.right ?? 14 }

  return {
    '--timeline-background': tokens.background,
    '--timeline-padding-left': `${padding.left}px`,
    '--timeline-padding-right': `${padding.right}px`,
    '--timeline-track-height': `${tokens.trackHeight}px`,
    '--timeline-knob-size': `${tokens.knobSize}px`,
    '--timeline-knob-border': tokens.knobBorder,
    '--timeline-knob-border-active': tokens.knobBorderActive,
    '--timeline-track-bg': tokens.trackBg,
    '--timeline-track-fill': tokens.trackFill,
    '--timeline-buffer-fill': tokens.bufferFill,
    '--timeline-tick-major-color': tokens.tickMajorColor,
    '--timeline-tick-minor-color': tokens.tickMinorColor,
    '--timeline-tick-label-color': tokens.tickLabelColor,
    '--timeline-text-primary': tokens.textPrimary,
    '--timeline-text-secondary': tokens.textSecondary,
    '--timeline-btn-color': tokens.btnColor,
    '--timeline-btn-hover-color': tokens.btnHoverColor,
    '--timeline-border-color': tokens.borderColor
  }
}

function Ruler({ timestamps }: { timestamps: ArrayLike<number> }) {
  const duration = getDomain(timestamps)
  const ticks = useMemo(() => {
    const result: number[] = []
    for (let elapsed = 0; elapsed <= duration + 1e-9; elapsed += 2) {
      result.push(Number(elapsed.toFixed(6)))
    }
    const lastTick = result[result.length - 1] ?? 0
    if (duration - lastTick > 0.5) result.push(duration)
    return result
  }, [duration])

  return (
    <div className={cls.ruler}>
      {ticks.map(tick => (
        <div key={tick} className={cls.tick} style={{ left: `${(tick / duration) * 100}%` }}>
          <span className={cls.tickLabel}>{formatTime(tick)}</span>
          <div className={cls.tickLine} />
        </div>
      ))}
    </div>
  )
}

export function PlaybackTimeline() {
  const store = useSceneStoreApi()
  const timestamps = useSceneStore(state => state.timestamps)
  const isPlaying = useSceneStore(state => state.isPlaying)
  const [isDragging, setIsDragging] = useState(false)
  const trackRef = useRef<HTMLDivElement | null>(null)
  const progressFillRef = useRef<HTMLDivElement | null>(null)
  const bufferFillRef = useRef<HTMLDivElement | null>(null)
  const knobRef = useRef<HTMLDivElement | null>(null)
  const trackWidthRef = useRef(0)

  const updateVisuals = useCallback(() => {
    if (!timestamps || timestamps.length === 0) return
    const { frameIndex, bufferEndFrame } = store.getState()
    const framePercent = getPercent(getFrameTime(frameIndex, timestamps), timestamps)
    if (progressFillRef.current) {
      progressFillRef.current.style.transform = `scaleX(${framePercent / 100})`
    }
    if (knobRef.current) {
      knobRef.current.style.transform = `translateX(${(trackWidthRef.current * framePercent) / 100}px)`
    }

    const bufferFill = bufferFillRef.current
    if (!bufferFill) return
    if (bufferEndFrame <= frameIndex) {
      bufferFill.style.display = 'none'
      return
    }
    const bufferStart = framePercent
    const bufferEnd = getPercent(getFrameTime(bufferEndFrame, timestamps), timestamps)
    bufferFill.style.display = 'block'
    bufferFill.style.left = `${bufferStart}%`
    bufferFill.style.width = `${Math.max(0, bufferEnd - bufferStart)}%`
  }, [store, timestamps])

  useLayoutEffect(() => {
    const track = trackRef.current
    if (!track || !timestamps) return

    const updateTrackWidth = () => {
      trackWidthRef.current = track.offsetWidth
      updateVisuals()
    }
    updateTrackWidth()
    const resizeObserver = new ResizeObserver(updateTrackWidth)
    resizeObserver.observe(track)
    const unsubscribe = store.subscribe((state, previousState) => {
      if (
        state.frameIndex !== previousState.frameIndex ||
        state.bufferEndFrame !== previousState.bufferEndFrame
      ) {
        updateVisuals()
      }
    })

    return () => {
      resizeObserver.disconnect()
      unsubscribe()
    }
  }, [store, timestamps, updateVisuals])

  const seekFromPointer = useCallback(
    (clientX: number) => {
      const track = trackRef.current
      if (!track || !timestamps || timestamps.length === 0) return
      const bounds = track.getBoundingClientRect()
      const ratio = clamp((clientX - bounds.left) / bounds.width, 0, 1)
      const targetTime = getStartTime(timestamps) + ratio * getDomain(timestamps)
      store.getState().setFrameIndex(findNearestFrameIndex(timestamps, targetTime))
    },
    [store, timestamps]
  )

  const handlePointerDown = (event: PointerEvent<HTMLDivElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId)
    setIsDragging(true)
    seekFromPointer(event.clientX)
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const state = store.getState()
    if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') {
      state.setFrameIndex(Math.max(0, state.frameIndex - 1))
      event.preventDefault()
    } else if (event.key === 'ArrowRight' || event.key === 'ArrowUp') {
      state.setFrameIndex(Math.min(Math.max(0, state.totalFrames - 1), state.frameIndex + 1))
      event.preventDefault()
    } else if (event.key === ' ') {
      if (state.isPlaying) state.pause()
      else state.play()
      event.preventDefault()
    }
  }

  const style = useMemo(() => buildTokenStyle(svgTokens.timeline), [])
  if (!timestamps || timestamps.length === 0) return null

  return (
    <div
      className={cls.root}
      role='region'
      aria-label='Playback controls'
      tabIndex={0}
      onKeyDown={handleKeyDown}
      style={style}
    >
      <div className={cls.controlRow}>
        <button
          className={cls.playButton}
          onClick={isPlaying ? store.getState().pause : store.getState().play}
          aria-label={isPlaying ? 'Pause' : 'Play'}
          type='button'
        >
          {isPlaying ? (
            <Pause
              className={cls.playIcon}
              aria-hidden='true'
              fill='currentColor'
              strokeWidth={0}
            />
          ) : (
            <Play className={cls.playIcon} aria-hidden='true' fill='currentColor' strokeWidth={0} />
          )}
        </button>
        <div className={cls.trackColumn}>
          <Ruler timestamps={timestamps} />
          <div
            ref={trackRef}
            className={cls.trackInteractive}
            onPointerDown={handlePointerDown}
            onPointerMove={event => {
              if (isDragging) seekFromPointer(event.clientX)
            }}
            onPointerUp={() => setIsDragging(false)}
            onPointerCancel={() => setIsDragging(false)}
          >
            <div className={cls.track}>
              <div ref={bufferFillRef} className={cls.bufferFill} />
              <div
                ref={progressFillRef}
                className={`${cls.progressFill} ${isPlaying || isDragging ? 'transition-none' : 'transition-transform duration-300'}`}
              />
            </div>
            <div
              ref={knobRef}
              className={`${cls.knob} border-[var(--timeline-knob-border)] ${isPlaying || isDragging ? 'transition-none' : 'transition-[transform,border-color] duration-300'}`}
            />
          </div>
        </div>
      </div>
    </div>
  )
}
