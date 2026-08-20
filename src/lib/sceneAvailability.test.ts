import { describe, expect, it, vi } from 'vitest'
import type { ProjectionMapPoint } from '@/types/scene'
import { SceneAvailabilityProbe } from './sceneAvailability'

function scene(scene_name: string, split: ProjectionMapPoint['split']): ProjectionMapPoint {
  return { scene_name, split, scene_token: 'token', tsne_comp1: 0, tsne_comp2: 0 }
}

describe('SceneAvailabilityProbe', () => {
  it('calls the default fetch with the global receiver', async () => {
    const fetchScene = vi
      .fn()
      .mockResolvedValue(
        new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } })
      )
    vi.stubGlobal('fetch', fetchScene)

    try {
      const probe = new SceneAvailabilityProbe()

      await expect(probe.check(scene('scene-0017', 'val'))).resolves.toBe('available')
      expect(fetchScene.mock.contexts[0]).toBe(globalThis)
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('does not request detail data for a train scene', async () => {
    const fetchScene = vi.fn()
    const probe = new SceneAvailabilityProbe(fetchScene)

    await expect(probe.check(scene('scene-0369', 'train'))).resolves.toBe('missing')
    expect(fetchScene).not.toHaveBeenCalled()
  })

  it('caches a confirmed missing val scene', async () => {
    const fetchScene = vi.fn().mockResolvedValue(new Response(null, { status: 404 }))
    const probe = new SceneAvailabilityProbe(fetchScene)
    const target = scene('scene-0017', 'val')

    await expect(probe.check(target)).resolves.toBe('missing')
    await expect(probe.check(target)).resolves.toBe('missing')
    expect(fetchScene).toHaveBeenCalledTimes(1)
  })

  it('does not cache a temporary upstream failure', async () => {
    const fetchScene = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 502 }))
      .mockResolvedValueOnce(
        new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } })
      )
    const probe = new SceneAvailabilityProbe(fetchScene)
    const target = scene('scene-0017', 'val')

    await expect(probe.check(target)).resolves.toBe('temporary-error')
    await expect(probe.check(target)).resolves.toBe('available')
    expect(fetchScene).toHaveBeenCalledTimes(2)
  })
})
