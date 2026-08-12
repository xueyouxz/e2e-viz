import { describe, expect, it, vi } from 'vitest'
import { GlyphImageLoader } from './glyphImageLoader'

function deferredResponse() {
  let resolve!: (response: Response) => void
  const promise = new Promise<Response>(done => {
    resolve = done
  })
  return { promise, resolve }
}

function imageResponse(body = 'image'): Response {
  const blob = new Blob([body], { type: 'image/webp' })
  return { ok: true, status: 200, blob: () => Promise.resolve(blob) } as Response
}

function errorResponse(status: number): Response {
  return { ok: false, status, blob: () => Promise.resolve(new Blob()) } as Response
}

describe('GlyphImageLoader', () => {
  it('uses the production concurrency and start interval defaults', async () => {
    const responses = Array.from({ length: 13 }, deferredResponse)
    let now = 0
    let active = 0
    let maxActive = 0
    const starts: number[] = []
    const wait = vi.fn(async (delayMs: number) => {
      now += delayMs
    })
    const fetchImage = vi.fn(() => {
      const response = responses[fetchImage.mock.calls.length - 1]
      starts.push(now)
      active += 1
      maxActive = Math.max(maxActive, active)
      return response.promise.finally(() => {
        active -= 1
      })
    })
    const loader = new GlyphImageLoader({
      fetchImage,
      wait,
      now: () => now,
      createObjectUrl: () => 'blob:image'
    })

    const requests = responses.map((_, index) => loader.load(`/glyph-${index}.webp`))
    await vi.waitFor(() => expect(fetchImage).toHaveBeenCalledTimes(12))
    expect(maxActive).toBe(12)
    expect(starts).toEqual(Array.from({ length: 12 }, (_, index) => index * 20))

    responses[0].resolve(imageResponse())
    await vi.waitFor(() => expect(fetchImage).toHaveBeenCalledTimes(13))
    responses.slice(1).forEach(response => response.resolve(imageResponse()))

    await expect(Promise.all(requests)).resolves.toHaveLength(13)
    expect(starts[12]).toBe(240)
  })

  it('deduplicates URLs and limits concurrent image requests', async () => {
    const responses = [deferredResponse(), deferredResponse(), deferredResponse()]
    let active = 0
    let maxActive = 0
    const fetchImage = vi.fn(() => {
      const response = responses[fetchImage.mock.calls.length - 1]
      active += 1
      maxActive = Math.max(maxActive, active)
      return response.promise.finally(() => {
        active -= 1
      })
    })
    const createObjectUrl = vi
      .fn<(blob: Blob) => string>()
      .mockReturnValueOnce('blob:a')
      .mockReturnValueOnce('blob:b')
      .mockReturnValueOnce('blob:c')
    const loader = new GlyphImageLoader({
      maxConcurrent: 2,
      minStartIntervalMs: 0,
      fetchImage,
      createObjectUrl
    })

    const first = loader.load('/glyph-a.webp')
    const duplicate = loader.load('/glyph-a.webp')
    const second = loader.load('/glyph-b.webp')
    const third = loader.load('/glyph-c.webp')

    await vi.waitFor(() => expect(fetchImage).toHaveBeenCalledTimes(2))
    expect(maxActive).toBe(2)

    responses[0].resolve(imageResponse('a'))
    await vi.waitFor(() => expect(fetchImage).toHaveBeenCalledTimes(3))
    responses[1].resolve(imageResponse('bb'))
    responses[2].resolve(imageResponse('ccc'))

    await expect(Promise.all([first, duplicate, second, third])).resolves.toEqual([
      'blob:a',
      'blob:a',
      'blob:b',
      'blob:c'
    ])
    expect(createObjectUrl).toHaveBeenCalledTimes(3)
    expect(maxActive).toBe(2)
  })

  it('retries temporary HTTP failures with exponential backoff', async () => {
    const fetchImage = vi
      .fn<() => Promise<Response>>()
      .mockResolvedValueOnce(errorResponse(503))
      .mockResolvedValueOnce(imageResponse())
    const wait = vi.fn<(delayMs: number, signal?: AbortSignal) => Promise<void>>(() =>
      Promise.resolve()
    )
    const loader = new GlyphImageLoader({
      minStartIntervalMs: 0,
      retryBaseDelayMs: 500,
      fetchImage,
      wait,
      createObjectUrl: () => 'blob:retry-success'
    })

    await expect(loader.load('/temporary.webp')).resolves.toBe('blob:retry-success')
    expect(fetchImage).toHaveBeenCalledTimes(2)
    expect(wait.mock.calls[0]?.[0]).toBe(500)
  })

  it('spaces request starts to avoid a browser-side burst', async () => {
    let now = 0
    const starts: number[] = []
    const wait = vi.fn(async (delayMs: number) => {
      now += delayMs
    })
    const fetchImage = vi.fn(async () => {
      starts.push(now)
      return imageResponse()
    })
    const loader = new GlyphImageLoader({
      maxConcurrent: 3,
      minStartIntervalMs: 50,
      fetchImage,
      wait,
      now: () => now,
      createObjectUrl: () => 'blob:image'
    })

    await Promise.all([
      loader.load('/one.webp'),
      loader.load('/two.webp'),
      loader.load('/three.webp')
    ])

    expect(starts).toEqual([0, 50, 100])
  })

  it('does not retry or repeatedly request a missing image', async () => {
    const fetchImage = vi.fn(() => Promise.resolve(errorResponse(404)))
    const wait = vi.fn(() => Promise.resolve())
    const loader = new GlyphImageLoader({
      minStartIntervalMs: 0,
      fetchImage,
      wait,
      createObjectUrl: () => 'unused'
    })

    const first = loader.load('/missing.webp')
    await expect(first).rejects.toMatchObject({ status: 404 })
    await expect(loader.load('/missing.webp')).rejects.toMatchObject({ status: 404 })
    expect(fetchImage).toHaveBeenCalledTimes(1)
    expect(wait).not.toHaveBeenCalled()
  })

  it('cancels a queued image when it no longer has visible consumers', async () => {
    const firstResponse = deferredResponse()
    const fetchImage = vi
      .fn<(url: string, signal: AbortSignal) => Promise<Response>>()
      .mockReturnValueOnce(firstResponse.promise)
    const loader = new GlyphImageLoader({
      maxConcurrent: 1,
      minStartIntervalMs: 0,
      fetchImage,
      createObjectUrl: () => 'blob:first'
    })
    const controller = new AbortController()

    const first = loader.load('/visible.webp')
    const stale = loader.load('/offscreen.webp', { signal: controller.signal })
    controller.abort()

    await expect(stale).rejects.toMatchObject({ name: 'AbortError' })
    firstResponse.resolve(imageResponse())
    await expect(first).resolves.toBe('blob:first')
    expect(fetchImage).toHaveBeenCalledTimes(1)
  })

  it('does not cache an image cancelled while its Blob is being read', async () => {
    let resolveBlob!: (blob: Blob) => void
    const blob = new Promise<Blob>(resolve => {
      resolveBlob = resolve
    })
    const fetchImage = vi.fn(() =>
      Promise.resolve({ ok: true, blob: () => blob } as unknown as Response)
    )
    const createObjectUrl = vi.fn(() => 'blob:cancelled')
    const loader = new GlyphImageLoader({
      minStartIntervalMs: 0,
      fetchImage,
      createObjectUrl
    })
    const controller = new AbortController()

    const request = loader.load('/slow-blob.webp', { signal: controller.signal })
    await vi.waitFor(() => expect(fetchImage).toHaveBeenCalledOnce())
    controller.abort()
    resolveBlob(new Blob(['image']))

    await expect(request).rejects.toMatchObject({ name: 'AbortError' })
    expect(createObjectUrl).not.toHaveBeenCalled()
  })

  it('revokes the least recently used Blob URL when the cache is full', async () => {
    const fetchImage = vi.fn(() => Promise.resolve(imageResponse()))
    const createObjectUrl = vi
      .fn<(blob: Blob) => string>()
      .mockReturnValueOnce('blob:first')
      .mockReturnValueOnce('blob:second')
    const revokeObjectUrl = vi.fn()
    const loader = new GlyphImageLoader({
      maxCached: 1,
      minStartIntervalMs: 0,
      fetchImage,
      createObjectUrl,
      revokeObjectUrl
    })

    await loader.load('/first.webp')
    await loader.load('/second.webp')

    expect(revokeObjectUrl).toHaveBeenCalledWith('blob:first')
  })
})
