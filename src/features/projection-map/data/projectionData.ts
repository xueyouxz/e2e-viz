import type { ProjectionMapPoint } from '@/types/scene'

export type ProjectionPayload = {
  scene_counts: number
  scenes: ProjectionMapPoint[]
}

const PROJECTION_PATH = '/data/projection-map/dimension_reduction.json'
const RETRYABLE_STATUS_CODES = new Set([429, 502, 503, 504])

type FetchData = (path: string, init?: RequestInit) => Promise<Response>
type Wait = (delayMs: number) => Promise<void>

type ProjectionDataLoaderOptions = {
  path?: string
  fetchData?: FetchData
  wait?: Wait
  maxRetries?: number
  retryBaseDelayMs?: number
  requestTimeoutMs?: number
}

export class ProjectionDataHttpError extends Error {
  constructor(
    public readonly path: string,
    public readonly status: number
  ) {
    super(`Request failed: ${path} (${status})`)
    this.name = 'ProjectionDataHttpError'
  }
}

export class ProjectionDataTimeoutError extends Error {
  constructor(public readonly path: string) {
    super(`Request timed out: ${path}`)
    this.name = 'ProjectionDataTimeoutError'
  }
}

function isRetryable(error: unknown): boolean {
  return !(error instanceof ProjectionDataHttpError) || RETRYABLE_STATUS_CODES.has(error.status)
}

export class ProjectionDataLoader {
  readonly #path: string
  readonly #fetchData: FetchData
  readonly #wait: Wait
  readonly #maxRetries: number
  readonly #retryBaseDelayMs: number
  readonly #requestTimeoutMs: number
  #cached: ProjectionPayload | null = null
  #pending: Promise<ProjectionPayload> | null = null

  constructor(options: ProjectionDataLoaderOptions = {}) {
    this.#path = options.path ?? PROJECTION_PATH
    this.#fetchData =
      options.fetchData ?? ((path, init) => fetch(path, { credentials: 'same-origin', ...init }))
    this.#wait = options.wait ?? (delayMs => new Promise(resolve => setTimeout(resolve, delayMs)))
    this.#maxRetries = Math.max(0, Math.floor(options.maxRetries ?? 2))
    this.#retryBaseDelayMs = Math.max(0, options.retryBaseDelayMs ?? 250)
    this.#requestTimeoutMs = Math.max(1, options.requestTimeoutMs ?? 15_000)
  }

  peek(): ProjectionPayload | null {
    return this.#cached
  }

  load(): Promise<ProjectionPayload> {
    if (this.#cached) return Promise.resolve(this.#cached)
    if (this.#pending) return this.#pending

    this.#pending = this.#loadWithRetry()
      .then(payload => {
        this.#cached = payload
        return payload
      })
      .finally(() => {
        this.#pending = null
      })
    return this.#pending
  }

  async #loadWithRetry(): Promise<ProjectionPayload> {
    for (let attempt = 0; ; attempt += 1) {
      try {
        return await this.#loadAttempt()
      } catch (error) {
        if (!isRetryable(error) || attempt >= this.#maxRetries) throw error
        await this.#wait(this.#retryBaseDelayMs * 2 ** attempt)
      }
    }
  }

  async #loadAttempt(): Promise<ProjectionPayload> {
    const controller = new AbortController()
    const timeout = window.setTimeout(
      () => controller.abort(new ProjectionDataTimeoutError(this.#path)),
      this.#requestTimeoutMs
    )
    try {
      const response = await this.#fetchData(this.#path, { signal: controller.signal })
      if (!response.ok) throw new ProjectionDataHttpError(this.#path, response.status)
      return (await response.json()) as ProjectionPayload
    } finally {
      window.clearTimeout(timeout)
    }
  }
}

export const projectionDataLoader = new ProjectionDataLoader()
