const RETRYABLE_STATUS_CODES = new Set([429, 502, 503, 504])

export class RequestHttpError extends Error {
  constructor(
    public readonly path: string,
    public readonly status: number
  ) {
    super(`Request failed: ${path} (${status})`)
    this.name = 'RequestHttpError'
  }
}

class RequestTimeoutError extends Error {
  constructor() {
    super('Request timed out')
    this.name = 'RequestTimeoutError'
  }
}

type RetryOptions = {
  maxRetries?: number
  retryBaseDelayMs?: number
  requestTimeoutMs?: number
  wait?: (delayMs: number) => Promise<void>
}

// Covers both the request and body read. Parsing/decoding errors are not retried.
export async function requestWithRetry<T>(
  attempt: (signal: AbortSignal) => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const retries = Math.max(0, Math.floor(options.maxRetries ?? 2))
  const delay = Math.max(0, options.retryBaseDelayMs ?? 250)
  const wait = options.wait ?? (ms => new Promise(resolve => setTimeout(resolve, ms)))
  for (let index = 0; ; index++) {
    const controller = new AbortController()
    const timeout = setTimeout(
      () => controller.abort(new RequestTimeoutError()),
      Math.max(1, options.requestTimeoutMs ?? 15_000)
    )
    try {
      return await attempt(controller.signal)
    } catch (error) {
      const retryable =
        error instanceof RequestHttpError
          ? RETRYABLE_STATUS_CODES.has(error.status)
          : error instanceof TypeError || error instanceof RequestTimeoutError
      if (!retryable || index >= retries) throw error
    } finally {
      clearTimeout(timeout)
    }
    await wait(delay * 2 ** index)
  }
}
