import { describe, expect, it, vi } from 'vitest'
import { ProjectionDataLoader } from './projectionData'

const payload = {
  scene_counts: 1,
  scenes: [
    {
      scene_name: 'scene-0000',
      scene_token: 'token',
      split: 'train' as const,
      tsne_comp1: 0,
      tsne_comp2: 0
    }
  ]
}

describe('ProjectionDataLoader', () => {
  it('deduplicates concurrent callers and caches the successful payload', async () => {
    const fetchData = vi.fn(async () => new Response(JSON.stringify(payload), { status: 200 }))
    const loader = new ProjectionDataLoader({ fetchData })

    const [first, second] = await Promise.all([loader.load(), loader.load()])
    const cached = await loader.load()

    expect(first).toEqual(payload)
    expect(second).toBe(first)
    expect(cached).toBe(first)
    expect(fetchData).toHaveBeenCalledTimes(1)
  })

  it('retries a temporary upstream failure before succeeding', async () => {
    const fetchData = vi
      .fn()
      .mockResolvedValueOnce(new Response('', { status: 502 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(payload), { status: 200 }))
    const wait = vi.fn(async () => undefined)
    const loader = new ProjectionDataLoader({ fetchData, wait, maxRetries: 2 })

    await expect(loader.load()).resolves.toEqual(payload)
    expect(fetchData).toHaveBeenCalledTimes(2)
    expect(wait).toHaveBeenCalledTimes(1)
  })

  it('does not retry a permanent missing-data response', async () => {
    const fetchData = vi.fn(async () => new Response('', { status: 404 }))
    const wait = vi.fn(async () => undefined)
    const loader = new ProjectionDataLoader({ fetchData, wait, maxRetries: 2 })

    await expect(loader.load()).rejects.toMatchObject({ status: 404 })
    expect(fetchData).toHaveBeenCalledTimes(1)
    expect(wait).not.toHaveBeenCalled()
  })

  it('aborts an upstream response body that exceeds the attempt timeout', async () => {
    vi.useFakeTimers()
    const fetchData = vi.fn(async (_path: string, init?: RequestInit) => {
      return {
        ok: true,
        status: 200,
        json: () =>
          new Promise((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () => reject(init.signal?.reason))
          })
      } as Response
    })
    const loader = new ProjectionDataLoader({
      fetchData,
      maxRetries: 0,
      requestTimeoutMs: 1_000
    })

    const request = expect(loader.load()).rejects.toMatchObject({
      name: 'RequestTimeoutError'
    })
    await vi.advanceTimersByTimeAsync(1_000)

    await request
    vi.useRealTimers()
  })
})
