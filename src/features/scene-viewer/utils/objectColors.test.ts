import { describe, it, expect } from 'vitest'
import { getObjectColor } from './objectColors'

describe('getObjectColor', () => {
  it('returns correct color for known class ids', () => {
    expect(getObjectColor(0).color).toBe('#6B7280') // unknown
    expect(getObjectColor(4).color).toBe('#4B8CF8') // car
    expect(getObjectColor(7).color).toBe('#16A34A') // pedestrian
    expect(getObjectColor(10).color).toBe('#0284C7') // truck
  })

  it('returns fallback color for unknown class ids', () => {
    const fallback = getObjectColor(99)
    expect(fallback.color).toBe('#9CA3AF')
    expect(fallback.strokeOpacity).toBe(0.64)
  })

  it('returns correct strokeOpacity for all known classes', () => {
    for (let id = 0; id <= 10; id++) {
      expect(getObjectColor(id).strokeOpacity).toBe(0.8)
    }
  })

  it('returns fallback for negative class id', () => {
    expect(getObjectColor(-1).color).toBe('#9CA3AF')
  })
})
