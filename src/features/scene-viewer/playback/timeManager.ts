export interface PlaybackTimeResult {
  timeSeconds: number
  targetFrameIndex: number
  reachedEnd: boolean
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value))
}

export function findNearestFrameIndex(
  timestamps: ArrayLike<number>,
  targetTimeSeconds: number
): number {
  if (timestamps.length <= 1) return 0

  const first = timestamps[0] ?? 0
  const last = timestamps[timestamps.length - 1] ?? first
  const target = clamp(targetTimeSeconds, first, last)
  let low = 0
  let high = timestamps.length - 1

  while (low < high) {
    const middle = Math.floor((low + high) / 2)
    if ((timestamps[middle] ?? first) < target) low = middle + 1
    else high = middle
  }

  const nextIndex = low
  const previousIndex = Math.max(0, low - 1)
  const previousDistance = Math.abs(target - (timestamps[previousIndex] ?? first))
  const nextDistance = Math.abs((timestamps[nextIndex] ?? last) - target)
  return nextDistance < previousDistance ? nextIndex : previousIndex
}

export function advancePlaybackTime(
  currentTimeSeconds: number,
  deltaSeconds: number,
  playbackSpeed: number,
  timestamps: ArrayLike<number>
): PlaybackTimeResult {
  if (timestamps.length === 0) {
    return { timeSeconds: 0, targetFrameIndex: 0, reachedEnd: true }
  }

  const startTime = timestamps[0] ?? 0
  const endTime = timestamps[timestamps.length - 1] ?? startTime
  const safeCurrentTime = clamp(currentTimeSeconds, startTime, endTime)
  const elapsedSeconds = Math.max(0, deltaSeconds) * Math.max(0, playbackSpeed)
  const timeSeconds = Math.min(endTime, safeCurrentTime + elapsedSeconds)

  return {
    timeSeconds,
    targetFrameIndex: findNearestFrameIndex(timestamps, timeSeconds),
    reachedEnd: timeSeconds >= endTime
  }
}
