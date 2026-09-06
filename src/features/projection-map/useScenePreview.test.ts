// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { sceneAvailabilityProbe, type SceneAvailability } from './data/sceneAvailability'
import { useScenePreview } from './useScenePreview'
import type { ProjectionMapPoint } from './types'

const scene = (name: string): ProjectionMapPoint => ({
  scene_name: name,
  scene_token: name,
  split: 'val',
  tsne_comp1: 0,
  tsne_comp2: 0
})
function deferred() {
  let resolve!: (value: SceneAvailability) => void
  const promise = new Promise<SceneAvailability>(done => {
    resolve = done
  })
  return { promise, resolve }
}
afterEach(() => vi.restoreAllMocks())

it('opens only the most recently clicked scene when checks return out of order', async () => {
  const a = deferred(),
    b = deferred()
  vi.spyOn(sceneAvailabilityProbe, 'check')
    .mockReturnValueOnce(a.promise)
    .mockReturnValueOnce(b.promise)
  const { result } = renderHook(useScenePreview)
  act(() => {
    void result.current.open(scene('a'))
    void result.current.open(scene('b'))
  })
  await act(async () => b.resolve('available'))
  expect(result.current.activeScene).toBe('b')
  await act(async () => a.resolve('available'))
  expect(result.current.activeScene).toBe('b')
})

it('invalidates pending scene opens when the preview closes', async () => {
  const pending = deferred()
  vi.spyOn(sceneAvailabilityProbe, 'check').mockReturnValue(pending.promise)
  const { result } = renderHook(useScenePreview)
  act(() => {
    void result.current.open(scene('a'))
    result.current.close()
  })
  await act(async () => pending.resolve('available'))
  expect(result.current.activeScene).toBeNull()
})
