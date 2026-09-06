import atlasConfig from '../../../../glyph-atlas.config.json'

import { RequestHttpError, requestWithRetry } from '../data/request'

export const GLYPH_ATLAS = {
  url: `/data/glyphs/${atlasConfig.fileName}`,
  columns: atlasConfig.columns,
  rows: atlasConfig.rows,
  cellSize: atlasConfig.cellSize,
  sourceSize: atlasConfig.sourceSize,
  padding: atlasConfig.padding
} as const

type GlyphAtlasSourceRect = {
  sx: number
  sy: number
  size: number
}

type GlyphAtlasLoaderOptions = {
  fetchImage?: (url: string, init?: RequestInit) => Promise<Response>
  decode?: (blob: Blob) => Promise<ImageBitmap>
  wait?: (delayMs: number) => Promise<void>
  maxRetries?: number
  retryBaseDelayMs?: number
  requestTimeoutMs?: number
}

type AtlasSnapshot = {
  status: 'loading' | 'ready' | 'error'
  bitmap: ImageBitmap | null
}

export function glyphAtlasSourceRect(sceneName: string): GlyphAtlasSourceRect | null {
  const match = /^scene-(\d{4})$/.exec(sceneName)
  if (!match) return null

  const index = Number(match[1])
  if (
    !Number.isSafeInteger(index) ||
    index < 0 ||
    index >= GLYPH_ATLAS.columns * GLYPH_ATLAS.rows
  ) {
    return null
  }

  const column = index % GLYPH_ATLAS.columns
  const row = Math.floor(index / GLYPH_ATLAS.columns)
  return {
    sx: column * GLYPH_ATLAS.cellSize + GLYPH_ATLAS.padding,
    sy: row * GLYPH_ATLAS.cellSize + GLYPH_ATLAS.padding,
    size: GLYPH_ATLAS.sourceSize
  }
}

// App-scoped bitmap: the map and virtualized thumbnails share one decode.
export class GlyphAtlasLoader {
  #snapshot: AtlasSnapshot = { status: 'loading', bitmap: null }
  #loading: Promise<ImageBitmap> | null = null
  #listeners = new Set<() => void>()

  constructor(private readonly options: GlyphAtlasLoaderOptions = {}) {}

  getSnapshot = (): AtlasSnapshot => this.#snapshot
  subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener)
    return () => {
      this.#listeners.delete(listener)
    }
  }

  #publish(snapshot: AtlasSnapshot) {
    this.#snapshot = snapshot
    for (const listener of this.#listeners) listener()
  }

  load(): Promise<ImageBitmap> {
    if (this.#snapshot.bitmap) return Promise.resolve(this.#snapshot.bitmap)
    if (this.#loading) return this.#loading
    const fetchImage =
      this.options.fetchImage ??
      ((url, init) => fetch(url, { credentials: 'same-origin', cache: 'force-cache', ...init }))
    const decode = this.options.decode ?? (blob => createImageBitmap(blob))
    this.#loading = requestWithRetry(
      async signal => {
        const response = await fetchImage(GLYPH_ATLAS.url, { signal })
        if (!response.ok) throw new RequestHttpError(GLYPH_ATLAS.url, response.status)
        return await decode(await response.blob())
      },
      { maxRetries: 3, retryBaseDelayMs: 500, ...this.options }
    )
      .then(
        bitmap => {
          this.#publish({ status: 'ready', bitmap })
          return bitmap
        },
        error => {
          this.#publish({ status: 'error', bitmap: null })
          throw error
        }
      )
      .finally(() => {
        this.#loading = null
      })
    this.#publish({ status: 'loading', bitmap: null })
    return this.#loading
  }
}

export const glyphAtlasLoader = new GlyphAtlasLoader()
