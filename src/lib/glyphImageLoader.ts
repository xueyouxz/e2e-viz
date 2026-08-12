const RETRYABLE_STATUS_CODES = new Set([429, 502, 503, 504])
const GLYPH_BASE = '/data/glyphs/'

type FetchImage = (url: string, signal: AbortSignal) => Promise<Response>
type Wait = (delayMs: number, signal?: AbortSignal) => Promise<void>

type GlyphImageLoaderOptions = {
  maxConcurrent?: number
  minStartIntervalMs?: number
  maxRetries?: number
  retryBaseDelayMs?: number
  maxCached?: number
  fetchImage?: FetchImage
  wait?: Wait
  createObjectUrl?: (blob: Blob) => string
  revokeObjectUrl?: (url: string) => void
  now?: () => number
}

type LoadOptions = {
  signal?: AbortSignal
}

type Consumer = {
  resolve: (objectUrl: string) => void
  reject: (error: unknown) => void
  signal?: AbortSignal
  onAbort?: () => void
}

type RequestEntry = {
  url: string
  state: 'queued' | 'active' | 'fulfilled' | 'rejected'
  controller: AbortController
  consumers: Set<Consumer>
  objectUrl?: string
  error?: unknown
}

export class GlyphImageHttpError extends Error {
  constructor(public readonly status: number) {
    super(`Glyph image request failed with status ${status}`)
    this.name = 'GlyphImageHttpError'
  }
}

export function glyphImageUrl(sceneName: string): string {
  return `${GLYPH_BASE}${sceneName}.webp`
}

function cancelledError(): DOMException {
  return new DOMException('Glyph image request was cancelled', 'AbortError')
}

function isCancelled(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError'
}

function isRetryable(error: unknown): boolean {
  return !(error instanceof GlyphImageHttpError) || RETRYABLE_STATUS_CODES.has(error.status)
}

export class GlyphImageLoader {
  readonly #maxConcurrent: number
  readonly #minStartIntervalMs: number
  readonly #maxRetries: number
  readonly #retryBaseDelayMs: number
  readonly #maxCached: number
  readonly #fetchImage: FetchImage
  readonly #wait: Wait
  readonly #createObjectUrl: (blob: Blob) => string
  readonly #revokeObjectUrl: (url: string) => void
  readonly #now: () => number
  readonly #entries = new Map<string, RequestEntry>()
  readonly #fulfilled = new Map<string, true>()
  readonly #queue: RequestEntry[] = []
  #active = 0
  #nextStartAt = 0
  #startGate: Promise<void> = Promise.resolve()

  constructor(options: GlyphImageLoaderOptions = {}) {
    this.#maxConcurrent = Math.max(1, Math.floor(options.maxConcurrent ?? 12))
    this.#minStartIntervalMs = Math.max(0, options.minStartIntervalMs ?? 20)
    this.#maxRetries = Math.max(0, Math.floor(options.maxRetries ?? 3))
    this.#retryBaseDelayMs = Math.max(0, options.retryBaseDelayMs ?? 500)
    this.#maxCached = Math.max(1, Math.floor(options.maxCached ?? 1_000))
    this.#fetchImage =
      options.fetchImage ?? ((url, signal) => fetch(url, { credentials: 'same-origin', signal }))
    this.#wait = options.wait ?? this.#defaultWait
    this.#createObjectUrl = options.createObjectUrl ?? (blob => URL.createObjectURL(blob))
    this.#revokeObjectUrl = options.revokeObjectUrl ?? (url => URL.revokeObjectURL(url))
    this.#now = options.now ?? Date.now
  }

  load(url: string, options: LoadOptions = {}): Promise<string> {
    let entry = this.#entries.get(url)
    if (entry?.state === 'fulfilled') {
      this.#touch(entry)
      return Promise.resolve(entry.objectUrl as string)
    }
    if (entry?.state === 'rejected') return Promise.reject(entry.error)

    const isNew = !entry
    if (!entry) {
      entry = {
        url,
        state: 'queued',
        controller: new AbortController(),
        consumers: new Set()
      }
      this.#entries.set(url, entry)
      this.#queue.push(entry)
    }

    const request = this.#subscribe(entry, options.signal)
    if (isNew) this.#drain()
    return request
  }

  #subscribe(entry: RequestEntry, signal?: AbortSignal): Promise<string> {
    return new Promise((resolve, reject) => {
      const consumer: Consumer = { resolve, reject, signal }
      entry.consumers.add(consumer)

      const onAbort = () => {
        if (!entry.consumers.delete(consumer)) return
        signal?.removeEventListener('abort', onAbort)
        reject(cancelledError())
        this.#cancelUnused(entry)
      }
      consumer.onAbort = onAbort

      if (signal?.aborted) onAbort()
      else signal?.addEventListener('abort', onAbort, { once: true })
    })
  }

  #cancelUnused(entry: RequestEntry): void {
    if (entry.consumers.size > 0) return
    if (entry.state === 'queued') {
      const queueIndex = this.#queue.indexOf(entry)
      if (queueIndex >= 0) this.#queue.splice(queueIndex, 1)
      this.#entries.delete(entry.url)
    } else if (entry.state === 'active') {
      entry.controller.abort()
    }
  }

  #drain(): void {
    while (this.#active < this.#maxConcurrent && this.#queue.length > 0) {
      const entry = this.#queue.shift()
      if (!entry || entry.consumers.size === 0) continue
      entry.state = 'active'
      this.#active += 1
      void this.#run(entry).finally(() => {
        this.#active -= 1
        this.#drain()
      })
    }
  }

  async #run(entry: RequestEntry): Promise<void> {
    try {
      const objectUrl = await this.#loadWithRetry(entry)
      entry.state = 'fulfilled'
      entry.objectUrl = objectUrl
      this.#remember(entry)
      this.#settle(entry, objectUrl)
    } catch (error) {
      if (isCancelled(error)) {
        this.#entries.delete(entry.url)
      } else if (isRetryable(error)) {
        this.#entries.delete(entry.url)
        this.#settle(entry, undefined, error)
      } else {
        entry.state = 'rejected'
        entry.error = error
        this.#settle(entry, undefined, error)
      }
    }
  }

  #settle(entry: RequestEntry, objectUrl?: string, error?: unknown): void {
    for (const consumer of entry.consumers) {
      if (consumer.onAbort) consumer.signal?.removeEventListener('abort', consumer.onAbort)
      if (error === undefined && objectUrl !== undefined) consumer.resolve(objectUrl)
      else consumer.reject(error)
    }
    entry.consumers.clear()
  }

  #remember(entry: RequestEntry): void {
    this.#fulfilled.delete(entry.url)
    this.#fulfilled.set(entry.url, true)
    while (this.#fulfilled.size > this.#maxCached) {
      const oldestUrl = this.#fulfilled.keys().next().value as string | undefined
      if (!oldestUrl) return
      this.#fulfilled.delete(oldestUrl)
      const oldest = this.#entries.get(oldestUrl)
      if (oldest?.state === 'fulfilled' && oldest.objectUrl) {
        this.#revokeObjectUrl(oldest.objectUrl)
        this.#entries.delete(oldestUrl)
      }
    }
  }

  #touch(entry: RequestEntry): void {
    this.#fulfilled.delete(entry.url)
    this.#fulfilled.set(entry.url, true)
  }

  async #loadWithRetry(entry: RequestEntry): Promise<string> {
    for (let attempt = 0; ; attempt += 1) {
      await this.#waitForStartSlot(entry.controller.signal)
      try {
        const response = await this.#fetchImage(entry.url, entry.controller.signal)
        if (!response.ok) throw new GlyphImageHttpError(response.status)
        const blob = await response.blob()
        if (entry.controller.signal.aborted) throw cancelledError()
        return this.#createObjectUrl(blob)
      } catch (error) {
        if (isCancelled(error) || entry.controller.signal.aborted) throw cancelledError()
        if (!isRetryable(error) || attempt >= this.#maxRetries) throw error
        await this.#wait(this.#retryBaseDelayMs * 2 ** attempt, entry.controller.signal)
      }
    }
  }

  #waitForStartSlot(signal: AbortSignal): Promise<void> {
    const scheduled = this.#startGate.then(async () => {
      if (signal.aborted) throw cancelledError()
      const delayMs = Math.max(0, this.#nextStartAt - this.#now())
      if (delayMs > 0) await this.#wait(delayMs, signal)
      if (signal.aborted) throw cancelledError()
      this.#nextStartAt = this.#now() + this.#minStartIntervalMs
    })
    this.#startGate = scheduled.catch(() => undefined)
    return scheduled
  }

  #defaultWait(delayMs: number, signal?: AbortSignal): Promise<void> {
    if (signal?.aborted) return Promise.reject(cancelledError())
    return new Promise((resolve, reject) => {
      const timer = window.setTimeout(() => {
        signal?.removeEventListener('abort', onAbort)
        resolve()
      }, delayMs)
      const onAbort = () => {
        window.clearTimeout(timer)
        reject(cancelledError())
      }
      signal?.addEventListener('abort', onAbort, { once: true })
    })
  }
}

export const glyphImageLoader = new GlyphImageLoader()
