import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { SceneLoadingOverlay } from './SceneLoadingOverlay'

describe('SceneLoadingOverlay', () => {
  it('shows a determinate first-frame download progress', () => {
    render(
      <SceneLoadingOverlay
        fullScreen
        progress={{ phase: 'first-frame', loadedBytes: 512 * 1024, totalBytes: 1024 * 1024 }}
      />
    )

    expect(screen.getByText('正在下载首帧数据')).toBeTruthy()
    expect(screen.getByText('75%')).toBeTruthy()
    expect(screen.getByText('512.0 KB / 1.0 MB')).toBeTruthy()
  })

  it('does not invent a percentage without Content-Length', () => {
    render(
      <SceneLoadingOverlay
        fullScreen
        progress={{ phase: 'metadata', loadedBytes: 512 * 1024, totalBytes: null }}
      />
    )

    expect(screen.getByText('正在传输')).toBeTruthy()
  })
})
