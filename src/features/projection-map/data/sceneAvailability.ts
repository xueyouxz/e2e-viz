import type { ProjectionMapPoint } from '../types'
import { requestWithRetry } from './request'

export type SceneAvailability = 'available' | 'missing' | 'temporary-error'
type FetchScene = (url: string, init?: RequestInit) => Promise<Response>

export class SceneAvailabilityProbe {
  readonly #cache = new Map<string, Exclude<SceneAvailability, 'temporary-error'>>()
  readonly #pending = new Map<string, Promise<SceneAvailability>>()

  constructor(private readonly fetchScene: FetchScene = fetch.bind(globalThis)) {}

  async check(scene: ProjectionMapPoint): Promise<SceneAvailability> {
    const name = scene.scene_name
    const cached = this.#cache.get(name)
    if (cached) return cached
    const pending = this.#pending.get(name)
    if (pending) return pending
    const request = this.#probe(name)
      .then(result => {
        if (result !== 'temporary-error') this.#cache.set(name, result)
        return result
      })
      .finally(() => {
        this.#pending.delete(name)
      })
    this.#pending.set(name, request)
    return request
  }

  async #probe(name: string): Promise<SceneAvailability> {
    try {
      return await requestWithRetry(
        async signal => {
          const response = await this.fetchScene(`/data/scenes/${name}/message_index.json`, {
            method: 'HEAD',
            signal
          })
          if (response.status === 404) return 'missing'
          if (!response.ok || !(response.headers.get('content-type') ?? '').includes('json'))
            return 'temporary-error'
          return 'available'
        },
        { maxRetries: 0 }
      )
    } catch {
      return 'temporary-error'
    }
  }
}

export const sceneAvailabilityProbe = new SceneAvailabilityProbe()
