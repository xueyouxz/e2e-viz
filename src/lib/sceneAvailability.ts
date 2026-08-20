import type { ProjectionMapPoint } from '@/types/scene'

export type SceneAvailability = 'available' | 'missing' | 'temporary-error'

type FetchScene = (url: string) => Promise<Response>

export class SceneAvailabilityProbe {
  readonly #fetchScene: FetchScene
  readonly #cache = new Map<string, Exclude<SceneAvailability, 'temporary-error'>>()

  constructor(fetchScene: FetchScene = fetch.bind(globalThis)) {
    this.#fetchScene = fetchScene
  }

  async check(scene: ProjectionMapPoint): Promise<SceneAvailability> {
    if (scene.split !== 'val') return 'missing'

    const cached = this.#cache.get(scene.scene_name)
    if (cached) return cached

    try {
      const response = await this.#fetchScene(`/data/scenes/${scene.scene_name}/message_index.json`)
      if (response.status === 404) {
        this.#cache.set(scene.scene_name, 'missing')
        return 'missing'
      }
      if (!response.ok) return 'temporary-error'

      const availability = (response.headers.get('content-type') ?? '').includes('json')
        ? 'available'
        : 'missing'
      this.#cache.set(scene.scene_name, availability)
      return availability
    } catch {
      return 'temporary-error'
    }
  }
}

export const sceneAvailabilityProbe = new SceneAvailabilityProbe()
