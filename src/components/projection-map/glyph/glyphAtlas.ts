import atlasConfig from '../../../../glyph-atlas.config.json'

const RETRYABLE_STATUS_CODES = new Set([429, 502, 503, 504])

export const GLYPH_ATLAS = {
  url: `/data/glyphs/${atlasConfig.fileName}`,
  columns: atlasConfig.columns,
  rows: atlasConfig.rows,
  cellSize: atlasConfig.cellSize,
  sourceSize: atlasConfig.sourceSize,
  padding: atlasConfig.padding
} as const

export type GlyphAtlasSourceRect = {
  sx: number
  sy: number
  size: number
}

type FetchImage = (url: string) => Promise<Response>
type DecodeImage = (blob: Blob) => Promise<ImageBitmap>
type Wait = (delayMs: number) => Promise<void>

type GlyphAtlasLoaderOptions = {
  fetchImage?: FetchImage
  decode?: DecodeImage
  wait?: Wait
  maxRetries?: number
  retryBaseDelayMs?: number
}

export class GlyphAtlasHttpError extends Error {
  constructor(public readonly status: number) {
    super(`Glyph atlas request failed with status ${status}`)
    this.name = 'GlyphAtlasHttpError'
  }
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

function isRetryable(error: unknown): boolean {
  return !(error instanceof GlyphAtlasHttpError) || RETRYABLE_STATUS_CODES.has(error.status)
}

export class GlyphAtlasLoader {
  readonly #fetchImage: FetchImage
  readonly #decode: DecodeImage
  readonly #wait: Wait
  readonly #maxRetries: number
  readonly #retryBaseDelayMs: number
  #bitmap: ImageBitmap | null = null
  #loading: Promise<ImageBitmap> | null = null

  constructor(options: GlyphAtlasLoaderOptions = {}) {
    this.#fetchImage =
      options.fetchImage ??
      (url => fetch(url, { credentials: 'same-origin', cache: 'force-cache' }))
    this.#decode = options.decode ?? (blob => createImageBitmap(blob))
    this.#wait = options.wait ?? (delayMs => new Promise(resolve => setTimeout(resolve, delayMs)))
    this.#maxRetries = Math.max(0, Math.floor(options.maxRetries ?? 3))
    this.#retryBaseDelayMs = Math.max(0, options.retryBaseDelayMs ?? 500)
  }

  load(): Promise<ImageBitmap> {
    if (this.#bitmap) return Promise.resolve(this.#bitmap)
    if (this.#loading) return this.#loading

    this.#loading = this.#loadWithRetry()
      .then(bitmap => {
        this.#bitmap = bitmap
        return bitmap
      })
      .finally(() => {
        this.#loading = null
      })
    return this.#loading
  }

  dispose(): void {
    this.#bitmap?.close()
    this.#bitmap = null
  }

  async #loadWithRetry(): Promise<ImageBitmap> {
    for (let attempt = 0; ; attempt += 1) {
      try {
        const response = await this.#fetchImage(GLYPH_ATLAS.url)
        if (!response.ok) throw new GlyphAtlasHttpError(response.status)
        return await this.#decode(await response.blob())
      } catch (error) {
        if (!isRetryable(error) || attempt >= this.#maxRetries) throw error
        await this.#wait(this.#retryBaseDelayMs * 2 ** attempt)
      }
    }
  }
}

export const glyphAtlasLoader = new GlyphAtlasLoader()
