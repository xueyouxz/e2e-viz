import {
  forwardRef,
  memo,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import type { CSSProperties, KeyboardEvent, PointerEvent, ReactNode } from 'react'
import { Pause, Play } from 'lucide-react'
import { useThemeTokens } from '../themeTokens'
import type { TimelineTokens } from '../themeTokens'
import styles from './PlaybackTimeline.module.css'

export interface BufferRange {
  start: number
  end: number
}

export interface TimelineMarker {
  time: number
  startTime?: number
  endTime?: number
  style?: CSSProperties
  content?: ReactNode
}

export interface PlaybackTimelineOptions {
  tickInterval?: number
  markers?: TimelineMarker[]
  formatTick?: (seconds: number) => string
  bufferRange?: BufferRange
}

export interface TimeChangePayload {
  frameIndex: number
  timeSeconds: number
  source: 'playback' | 'scrub' | 'keyboard'
}

interface PlaybackTimelineProps {
  timestamps: number[]
  frameIndex?: number
  isPlaying?: boolean
  onPlay?: () => void
  onPause?: () => void
  onTimeChange?: (payload: TimeChangePayload) => void
  className?: string
  options?: PlaybackTimelineOptions
}

// Imperative handle exposed by SliderTrack for direct DOM position updates.
interface SliderTrackHandle {
  setPosition: (percent: number) => void
}

interface SliderTrackProps {
  timestamps: number[]
  frameIndex: number
  markers: TimelineMarker[]
  bufferRange?: BufferRange
  onSeek: (timeSeconds: number) => void
  isPlaying: boolean
  isDragging: boolean
  setIsDragging: (isDragging: boolean) => void
}

type TimelineCssProperties = CSSProperties & Record<`--timeline-${string}`, string>

function clamp(value: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, value))
}

function fmtMMSS(seconds: number): string {
  const safeSeconds = Math.max(0, seconds)
  return (
    `${String(Math.floor(safeSeconds / 60)).padStart(2, '0')}` +
    `:${String(Math.floor(safeSeconds % 60)).padStart(2, '0')}`
  )
}

function getStartTime(timestamps: number[]): number {
  return timestamps[0] ?? 0
}

function getEndTime(timestamps: number[]): number {
  return timestamps[timestamps.length - 1] ?? getStartTime(timestamps)
}

function getDomain(timestamps: number[]): number {
  return Math.max(Number.EPSILON, getEndTime(timestamps) - getStartTime(timestamps))
}

function frameToTime(frameIndex: number, timestamps: number[]): number {
  if (timestamps.length === 0) return 0
  return timestamps[clamp(Math.round(frameIndex), 0, timestamps.length - 1)] ?? getStartTime(timestamps)
}

function timeToFrame(timeSeconds: number, timestamps: number[]): number {
  if (timestamps.length <= 1) return 0

  const first = getStartTime(timestamps)
  const last = getEndTime(timestamps)
  const target = clamp(timeSeconds, first, last)
  let lo = 0
  let hi = timestamps.length - 1

  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2)
    if ((timestamps[mid] ?? first) < target) lo = mid + 1
    else hi = mid
  }

  const nextIndex = lo
  const prevIndex = Math.max(0, lo - 1)
  const prevDistance = Math.abs(target - (timestamps[prevIndex] ?? first))
  const nextDistance = Math.abs((timestamps[nextIndex] ?? last) - target)
  return nextDistance < prevDistance ? nextIndex : prevIndex
}

function useStableCallback<T extends (...args: never[]) => unknown>(fn: T | undefined) {
  const ref = useRef(fn)
  useLayoutEffect(() => { ref.current = fn })
  return useCallback((...args: Parameters<T>): ReturnType<T> | undefined => {
    return ref.current?.(...args) as ReturnType<T> | undefined
  }, [])
}

function getPercentForTime(timeSeconds: number, timestamps: number[]): number {
  const startTime = getStartTime(timestamps)
  const domain = getDomain(timestamps)
  return clamp(((timeSeconds - startTime) / domain) * 100, 0, 100)
}

function getPercentForElapsedTime(elapsedSeconds: number, timestamps: number[]): number {
  return clamp((elapsedSeconds / getDomain(timestamps)) * 100, 0, 100)
}

function getBufferStyle(bufferRange: BufferRange | undefined, timestamps: number[]): CSSProperties | null {
  if (!bufferRange || timestamps.length <= 1) return null

  const startTime = getStartTime(timestamps)
  const endTime = getEndTime(timestamps)
  const rangeStart = clamp(Math.min(bufferRange.start, bufferRange.end), startTime, endTime)
  const rangeEnd = clamp(Math.max(bufferRange.start, bufferRange.end), startTime, endTime)
  const left = getPercentForTime(rangeStart, timestamps)
  const right = getPercentForTime(rangeEnd, timestamps)

  return {
    left: `${left}%`,
    width: `${Math.max(0, right - left)}%`,
  }
}

function buildTokenStyle(tokens: TimelineTokens): TimelineCssProperties {
  const padding = typeof tokens.padding === 'number'
    ? { left: tokens.padding, right: tokens.padding }
    : { left: tokens.padding.left ?? 14, right: tokens.padding.right ?? 14 }

  return {
    '--timeline-background':        tokens.background,
    '--timeline-padding-left':      `${padding.left}px`,
    '--timeline-padding-right':     `${padding.right}px`,
    '--timeline-track-height':      `${tokens.trackHeight}px`,
    '--timeline-knob-size':         `${tokens.knobSize}px`,
    '--timeline-knob-border':       tokens.knobBorder,
    '--timeline-knob-border-active': tokens.knobBorderActive,
    '--timeline-track-bg':          tokens.trackBg,
    '--timeline-track-fill':        tokens.trackFill,
    '--timeline-buffer-fill':       tokens.bufferFill,
    '--timeline-tick-major-color':  tokens.tickMajorColor,
    '--timeline-tick-minor-color':  tokens.tickMinorColor,
    '--timeline-tick-label-color':  tokens.tickLabelColor,
    '--timeline-text-primary':      tokens.textPrimary,
    '--timeline-text-secondary':    tokens.textSecondary,
    '--timeline-btn-color':         tokens.btnColor,
    '--timeline-btn-hover-color':   tokens.btnHoverColor,
    '--timeline-border-color':      tokens.borderColor,
  }
}

// ─── Sub-components ───────────────────────────────────────────────────────────

const Ruler = memo(function Ruler({
  timestamps,
  tickInterval,
  formatTick,
}: {
  timestamps: number[]
  tickInterval: number
  formatTick: (seconds: number) => string
}) {
  const duration = getDomain(timestamps)
  const ticks = useMemo(() => {
    if (tickInterval <= 0) return [0]

    const out: number[] = []
    for (let elapsed = 0; elapsed <= duration + 1e-9; elapsed += tickInterval) {
      out.push(Number(elapsed.toFixed(6)))
    }

    if (out.length === 0 || out[0] !== 0) out.unshift(0)
    const lastTick = out[out.length - 1] ?? 0
    if (duration - lastTick > tickInterval * 0.25) out.push(duration)

    return out
  }, [duration, tickInterval])

  return (
    <div className={styles.ruler}>
      {ticks.map((tick) => (
        <div
          key={tick}
          className={styles.tick}
          style={{ left: `${getPercentForElapsedTime(tick, timestamps)}%` }}
        >
          <span className={styles.tickLabel}>{formatTick(tick)}</span>
          <div className={styles.tickLine} />
        </div>
      ))}
    </div>
  )
})

// SliderTrack exposes setPosition for direct DOM updates during playback,
// bypassing React reconciliation entirely.
const SliderTrack = memo(forwardRef<SliderTrackHandle, SliderTrackProps>(function SliderTrack({
  timestamps,
  frameIndex,
  markers,
  bufferRange,
  onSeek,
  isPlaying,
  isDragging,
  setIsDragging,
}, ref) {
  const trackRef = useRef<HTMLDivElement | null>(null)
  const fillRef = useRef<HTMLDivElement | null>(null)
  const knobRef = useRef<HTMLDivElement | null>(null)
  const trackWidthRef = useRef(0)
  const [isHovered, setIsHovered] = useState(false)
  const currentTime = frameToTime(frameIndex, timestamps)
  const currentPercent = getPercentForTime(currentTime, timestamps)
  const noTransition = isPlaying || isDragging
  const bufferStyle = getBufferStyle(bufferRange, timestamps)

  // Cache track width for RAF loop — reading offsetWidth inside rAF forces layout.
  useLayoutEffect(() => {
    const el = trackRef.current
    if (!el) return
    trackWidthRef.current = el.offsetWidth
    const ro = new ResizeObserver(() => {
      if (trackRef.current) trackWidthRef.current = trackRef.current.offsetWidth
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // Keep knob at the correct compositor-safe position after each React render.
  useLayoutEffect(() => {
    if (knobRef.current) {
      knobRef.current.style.transform = `translateX(${trackWidthRef.current * currentPercent / 100}px)`
    }
  }, [currentPercent])

  useImperativeHandle(ref, () => ({
    setPosition(percent: number) {
      if (fillRef.current) fillRef.current.style.transform = `scaleX(${percent / 100})`
      if (knobRef.current) knobRef.current.style.transform = `translateX(${trackWidthRef.current * percent / 100}px)`
    },
  }), [])

  const seekFromPointer = useCallback(
    (clientX: number) => {
      const rect = trackRef.current?.getBoundingClientRect()
      if (!rect) return

      const startTime = getStartTime(timestamps)
      const domain = getDomain(timestamps)
      onSeek(startTime + ((clientX - rect.left) / rect.width) * domain)
    },
    [onSeek, timestamps],
  )

  const handlePointerDown = (event: PointerEvent<HTMLDivElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId)
    setIsDragging(true)
    seekFromPointer(event.clientX)
  }

  const handlePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (isDragging) seekFromPointer(event.clientX)
  }

  return (
    <div
      ref={trackRef}
      className={styles.trackInteractive}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={() => setIsDragging(false)}
      onPointerCancel={() => setIsDragging(false)}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      <div className={styles.track}>
        {bufferStyle && (
          <div
            className={`${styles.bufferFill} ${noTransition ? styles.noTransition : ''}`}
            style={bufferStyle}
          />
        )}
        <div
          ref={fillRef}
          className={`${styles.progressFill} ${noTransition ? styles.noTransition : ''}`}
          style={{ transform: `scaleX(${currentPercent / 100})` }}
        />
        {markers.map((marker, index) => {
          const markerStart = marker.startTime ?? marker.time
          const markerEnd = marker.endTime ?? marker.time
          const left = getPercentForTime(markerStart, timestamps)
          const right = getPercentForTime(markerEnd, timestamps)

          return (
            <div
              key={`${markerStart}-${markerEnd}-${index}`}
              className={styles.marker}
              style={{
                left: `${left}%`,
                width: `${Math.max(0, right - left)}%`,
                ...marker.style,
              }}
            >
              {marker.content}
            </div>
          )
        })}
      </div>
      <div
        ref={knobRef}
        className={`${styles.knob} ${isHovered || isDragging ? styles.knobActive : ''} ${
          noTransition ? styles.noTransition : ''
        }`}
      />
    </div>
  )
}))

const PlayButton = memo(function PlayButton({
  isPlaying,
  onPlay,
  onPause,
}: {
  isPlaying: boolean
  onPlay: () => void
  onPause: () => void
}) {
  return (
    <button
      className={styles.playButton}
      onClick={isPlaying ? onPause : onPlay}
      aria-label={isPlaying ? 'Pause' : 'Play'}
      type="button"
    >
      {isPlaying ? (
        <Pause className={styles.playIcon} aria-hidden="true" fill="currentColor" strokeWidth={0} />
      ) : (
        <Play className={styles.playIcon} aria-hidden="true" fill="currentColor" strokeWidth={0} />
      )}
    </button>
  )
})

// ─── Main component ───────────────────────────────────────────────────────────

export default function PlaybackTimeline({
  timestamps,
  frameIndex: controlledFrame,
  isPlaying: controlledPlaying,
  onPlay,
  onPause,
  onTimeChange,
  className = '',
  options = {},
}: PlaybackTimelineProps) {
  const {
    tickInterval = 2,
    markers = [],
    formatTick = fmtMMSS,
    bufferRange,
  } = options

  const tokens = useThemeTokens().timeline

  const isControlled = controlledFrame !== undefined && controlledPlaying !== undefined
  const maxFrameIndex = Math.max(0, timestamps.length - 1)
  const [internalFrame, setInternalFrame] = useState(0)
  const [internalPlaying, setInternalPlaying] = useState(false)
  const [isDragging, setIsDragging] = useState(false)
  const playbackStartWallRef = useRef<number | null>(null)
  const playbackStartTimeRef = useRef(0)
  const rafRef = useRef<number | null>(null)
  const timestampsRef = useRef(timestamps)
  const lastCommittedFrameRef = useRef(0)
  const stableOnTimeChange = useStableCallback(onTimeChange)

  // Tracks the frame the RAF loop last rendered — used to sync internalFrame
  // when playback stops without going through setInternalFrame every tick.
  const playbackFrameRef = useRef(0)

  // Stable reference to the current frameIndex for callbacks that would
  // otherwise capture a stale value via useCallback deps.
  const frameIndexRef = useRef(0)

  // Imperative handle to SliderTrack for direct DOM position updates.
  const sliderTrackRef = useRef<SliderTrackHandle>(null)

  useLayoutEffect(() => {
    timestampsRef.current = timestamps
  }, [timestamps])

  useEffect(() => {
    setInternalFrame(0)
    setInternalPlaying(false)
    lastCommittedFrameRef.current = 0
    playbackFrameRef.current = 0
    playbackStartWallRef.current = null
    playbackStartTimeRef.current = getStartTime(timestamps)
  }, [timestamps])

  const frameIndex = clamp(
    isControlled ? controlledFrame : internalFrame,
    0,
    maxFrameIndex,
  )
  const isPlaying = isControlled ? controlledPlaying : internalPlaying

  useLayoutEffect(() => {
    lastCommittedFrameRef.current = frameIndex
    frameIndexRef.current = frameIndex
  }, [frameIndex])

  const commitFrame = useCallback(
    (nextFrame: number, source: TimeChangePayload['source']) => {
      const clampedFrame = clamp(nextFrame, 0, maxFrameIndex)
      if (clampedFrame === lastCommittedFrameRef.current) return

      lastCommittedFrameRef.current = clampedFrame
      const timeSeconds = frameToTime(clampedFrame, timestampsRef.current)

      if (!isControlled) setInternalFrame(clampedFrame)
      stableOnTimeChange({ frameIndex: clampedFrame, timeSeconds, source })
    },
    [isControlled, maxFrameIndex, stableOnTimeChange],
  )

  const reanchor = useCallback((nextFrame: number) => {
    playbackStartWallRef.current = null
    playbackStartTimeRef.current = frameToTime(nextFrame, timestampsRef.current)
  }, [])

  // Playback RAF loop — updates the slider DOM directly to avoid React
  // re-renders at 60 fps. React state is only written when playback ends.
  useEffect(() => {
    if (isControlled || !isPlaying || isDragging || timestamps.length <= 1) {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
      return undefined
    }

    const tick = (now: number) => {
      if (playbackStartWallRef.current === null) playbackStartWallRef.current = now

      const elapsedSeconds = (now - playbackStartWallRef.current) / 1000
      const targetTime = playbackStartTimeRef.current + elapsedSeconds
      const ts = timestampsRef.current
      const endTime = getEndTime(ts)

      if (targetTime >= endTime) {
        const lastFrame = Math.max(0, ts.length - 1)
        sliderTrackRef.current?.setPosition(100)
        playbackFrameRef.current = lastFrame
        lastCommittedFrameRef.current = lastFrame
        stableOnTimeChange({ frameIndex: lastFrame, timeSeconds: endTime, source: 'playback' })
        // Single state write: batch both updates in one React commit.
        setInternalPlaying(false)
        setInternalFrame(lastFrame)
        return
      }

      const nextFrame = timeToFrame(targetTime, ts)
      const percent = getPercentForTime(targetTime, ts)

      // Direct DOM write — zero React overhead.
      sliderTrackRef.current?.setPosition(percent)
      playbackFrameRef.current = nextFrame

      if (nextFrame !== lastCommittedFrameRef.current) {
        lastCommittedFrameRef.current = nextFrame
        stableOnTimeChange({ frameIndex: nextFrame, timeSeconds: targetTime, source: 'playback' })
      }

      rafRef.current = requestAnimationFrame(tick)
    }

    rafRef.current = requestAnimationFrame(tick)
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
    }
  }, [isControlled, isDragging, isPlaying, stableOnTimeChange, timestamps.length])

  const handlePlay = useCallback(() => {
    if (isControlled) {
      onPlay?.()
      return
    }

    const nextFrame = frameIndexRef.current >= maxFrameIndex ? 0 : frameIndexRef.current
    playbackStartWallRef.current = null
    playbackStartTimeRef.current = frameToTime(nextFrame, timestampsRef.current)
    setInternalFrame(nextFrame)
    setInternalPlaying(true)
  }, [isControlled, maxFrameIndex, onPlay])

  const handlePause = useCallback(() => {
    if (isControlled) {
      onPause?.()
      return
    }
    // Sync React state to current visual frame before stopping.
    setInternalFrame(playbackFrameRef.current)
    setInternalPlaying(false)
  }, [isControlled, onPause])

  const handleSeek = useCallback(
    (timeSeconds: number) => {
      const nextFrame = timeToFrame(timeSeconds, timestampsRef.current)
      commitFrame(nextFrame, 'scrub')
      if (isPlaying) reanchor(nextFrame)
    },
    [commitFrame, isPlaying, reanchor],
  )

  // frameIndex removed from deps — read via frameIndexRef to keep this
  // callback stable across animation frames.
  const handleSetDragging = useCallback(
    (dragging: boolean) => {
      setIsDragging(dragging)
      if (!dragging && isPlaying) reanchor(frameIndexRef.current)
    },
    [isPlaying, reanchor],
  )

  // frameIndex removed from deps — read via frameIndexRef.
  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      const step = (delta: number) => {
        const nextFrame = clamp(frameIndexRef.current + delta, 0, maxFrameIndex)
        commitFrame(nextFrame, 'keyboard')
        if (isPlaying) reanchor(nextFrame)
      }

      switch (event.key) {
        case 'ArrowLeft':
        case 'ArrowDown':
          step(-1)
          event.preventDefault()
          break
        case 'ArrowRight':
        case 'ArrowUp':
          step(1)
          event.preventDefault()
          break
        case ' ':
          if (isPlaying) handlePause()
          else handlePlay()
          event.preventDefault()
          break
        default:
          break
      }
    },
    [commitFrame, handlePause, handlePlay, isPlaying, maxFrameIndex, reanchor],
  )

  const style = useMemo(() => buildTokenStyle(tokens), [tokens])
  const rootClassName = `${styles.root} ${className}`.trim()

  return (
    <div
      className={rootClassName}
      role="region"
      aria-label="Playback controls"
      tabIndex={0}
      onKeyDown={handleKeyDown}
      style={style}
    >
      <div className={styles.controlRow}>
        <PlayButton isPlaying={isPlaying} onPlay={handlePlay} onPause={handlePause} />
        <div className={styles.trackColumn}>
          <Ruler timestamps={timestamps} tickInterval={tickInterval} formatTick={formatTick} />
          <SliderTrack
            ref={sliderTrackRef}
            timestamps={timestamps}
            frameIndex={frameIndex}
            markers={markers}
            bufferRange={bufferRange}
            onSeek={handleSeek}
            isPlaying={isPlaying}
            isDragging={isDragging}
            setIsDragging={handleSetDragging}
          />
        </div>
      </div>
    </div>
  )
}
