import { describe, expect, it } from 'vitest'
import { advancePlaybackTime, findNearestFrameIndex } from '../timeManager'

describe('timeManager', () => {
  it('finds the nearest frame in irregular timestamps', () => {
    const timestamps = new Float32Array([0, 0.2, 0.9, 2])

    expect(findNearestFrameIndex(timestamps, -1)).toBe(0)
    expect(findNearestFrameIndex(timestamps, 0.6)).toBe(2)
    expect(findNearestFrameIndex(timestamps, 4)).toBe(3)
  })

  it('advances by delta and speed and stops on the final frame', () => {
    const timestamps = new Float32Array([0, 0.5, 1.5])

    expect(advancePlaybackTime(0, 0.25, 2, timestamps)).toEqual({
      timeSeconds: 0.5,
      targetFrameIndex: 1,
      reachedEnd: false
    })
    expect(advancePlaybackTime(1, 1, 1, timestamps)).toEqual({
      timeSeconds: 1.5,
      targetFrameIndex: 2,
      reachedEnd: true
    })
  })

  it('handles empty and single-frame timelines', () => {
    expect(advancePlaybackTime(0, 1, 1, [])).toEqual({
      timeSeconds: 0,
      targetFrameIndex: 0,
      reachedEnd: true
    })
    expect(advancePlaybackTime(4, 1, 1, new Float32Array([4]))).toEqual({
      timeSeconds: 4,
      targetFrameIndex: 0,
      reachedEnd: true
    })
  })
})
