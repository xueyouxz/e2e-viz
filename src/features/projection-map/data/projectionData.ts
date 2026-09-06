import type { ProjectionMapPoint } from '../types'
import { RequestHttpError, requestWithRetry } from './request'

type ProjectionPayload = {
  scene_counts: number
  scenes: ProjectionMapPoint[]
}

const PROJECTION_PATH = '/data/projection-map/dimension_reduction.json'

type ProjectionDataLoaderOptions = {
  path?: string
  fetchData?: (path: string, init?: RequestInit) => Promise<Response>
  wait?: (delayMs: number) => Promise<void>
  maxRetries?: number
  retryBaseDelayMs?: number
  requestTimeoutMs?: number
}

export class ProjectionDataLoader {
  #cached: ProjectionPayload | null = null
  #pending: Promise<ProjectionPayload> | null = null

  constructor(private readonly options: ProjectionDataLoaderOptions = {}) {}

  peek(): ProjectionPayload | null {
    return this.#cached
  }

  load(): Promise<ProjectionPayload> {
    if (this.#cached) return Promise.resolve(this.#cached)
    if (this.#pending) return this.#pending
    const path = this.options.path ?? PROJECTION_PATH
    const fetchData =
      this.options.fetchData ?? ((url, init) => fetch(url, { credentials: 'same-origin', ...init }))
    this.#pending = requestWithRetry(async signal => {
      const response = await fetchData(path, { signal })
      if (!response.ok) throw new RequestHttpError(path, response.status)
      return (await response.json()) as ProjectionPayload
    }, this.options)
      .then(payload => {
        this.#cached = payload
        return payload
      })
      .finally(() => {
        this.#pending = null
      })
    return this.#pending
  }
}

export const projectionDataLoader = new ProjectionDataLoader()
