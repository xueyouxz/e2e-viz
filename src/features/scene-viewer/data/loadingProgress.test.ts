import { describe, expect, it } from 'vitest'
import { formatByteSize, getLoadingLabel, getLoadingPercent } from './loadingProgress'

describe('scene loading progress', () => {
  it('maps known transfer bytes into the active phase range', () => {
    expect(getLoadingPercent({ phase: 'metadata', loadedBytes: 50, totalBytes: 100 })).toBe(33)
  })

  it('keeps the progress bar indeterminate when Content-Length is unavailable', () => {
    expect(
      getLoadingPercent({ phase: 'first-frame', loadedBytes: 1024, totalBytes: null })
    ).toBeNull()
  })

  it('finishes at 100 percent after the first frame is renderable', () => {
    expect(getLoadingPercent({ phase: 'ready', loadedBytes: 0, totalBytes: null })).toBe(100)
  })

  it('formats the transfer information for the loading overlay', () => {
    expect(formatByteSize(1536)).toBe('1.5 KB')
    expect(getLoadingLabel('parsing')).toBe('正在解析并准备渲染')
  })
})
