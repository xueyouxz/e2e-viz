import { describe, expect, it, vi } from 'vitest'
import { GLYPH_ATLAS, GlyphAtlasLoader, glyphAtlasSourceRect } from './glyphAtlas'
import { RequestHttpError } from '../data/request'

function response(status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    blob: vi.fn().mockResolvedValue({} as Blob)
  } as unknown as Response
}

describe('glyphAtlasSourceRect', () => {
  it('maps the numeric scene id into a deterministic atlas slot', () => {
    expect(glyphAtlasSourceRect('scene-0000')).toEqual({ sx: 2, sy: 2, size: 100 })
    expect(glyphAtlasSourceRect('scene-0034')).toEqual({ sx: 2, sy: 106, size: 100 })
    expect(glyphAtlasSourceRect('scene-1110')).toEqual({ sx: 2290, sy: 3330, size: 100 })
  })

  it('rejects names outside the fixed atlas layout', () => {
    expect(glyphAtlasSourceRect('scene-1122')).toBeNull()
    expect(glyphAtlasSourceRect('not-a-scene')).toBeNull()
  })
})

describe('glyph atlas', () => {
  it('deduplicates concurrent callers into one atlas request and decode', async () => {
    const bitmap = { close: vi.fn() } as unknown as ImageBitmap
    const fetchImage = vi.fn().mockResolvedValue(response())
    const decode = vi.fn().mockResolvedValue(bitmap)
    const loader = new GlyphAtlasLoader({ fetchImage, decode })

    await expect(Promise.all([loader.load(), loader.load()])).resolves.toEqual([bitmap, bitmap])
    expect(fetchImage).toHaveBeenCalledTimes(1)
    expect(fetchImage).toHaveBeenCalledWith(GLYPH_ATLAS.url, { signal: expect.any(AbortSignal) })
    expect(decode).toHaveBeenCalledTimes(1)
  })

  it('retries temporary upstream errors without creating parallel requests', async () => {
    const fetchImage = vi
      .fn()
      .mockResolvedValueOnce(response(502))
      .mockResolvedValueOnce(response())
    const wait = vi.fn().mockResolvedValue(undefined)
    const loader = new GlyphAtlasLoader({
      fetchImage,
      decode: vi.fn().mockResolvedValue({} as ImageBitmap),
      wait,
      maxRetries: 1,
      retryBaseDelayMs: 25
    })

    await expect(loader.load()).resolves.toBeDefined()
    expect(fetchImage).toHaveBeenCalledTimes(2)
    expect(wait).toHaveBeenCalledWith(25)
  })

  it('does not retry a permanent missing-atlas response', async () => {
    const loader = new GlyphAtlasLoader({
      fetchImage: vi.fn().mockResolvedValue(response(404)),
      decode: vi.fn(),
      wait: vi.fn(),
      maxRetries: 3
    })

    await expect(loader.load()).rejects.toEqual(new RequestHttpError(GLYPH_ATLAS.url, 404))
  })
})

it('notifies every atlas subscriber when a later caller recovers from a failed load', async () => {
  const bitmap = {} as ImageBitmap
  const loader = new GlyphAtlasLoader({
    fetchImage: vi.fn().mockResolvedValueOnce(response(404)).mockResolvedValueOnce(response()),
    decode: vi.fn().mockResolvedValue(bitmap),
    maxRetries: 0
  })
  const mapStates: string[] = []
  const thumbnailStates: string[] = []
  const unsubscribeMap = loader.subscribe(() => mapStates.push(loader.getSnapshot().status))
  const unsubscribeThumbnail = loader.subscribe(() =>
    thumbnailStates.push(loader.getSnapshot().status)
  )
  await expect(loader.load()).rejects.toMatchObject({ status: 404 })
  await loader.load()
  expect(mapStates).toEqual(['loading', 'error', 'loading', 'ready'])
  expect(thumbnailStates).toEqual(mapStates)
  expect(loader.getSnapshot().bitmap).toBe(bitmap)
  unsubscribeMap()
  unsubscribeThumbnail()
})
