import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SceneDataManager } from './SceneDataManager'
import type { MetadataParseResult } from './MetadataParser'
import type { RawDecodedFrame, SceneMetadata } from '../types'

const decoderMocks = vi.hoisted(() => ({
  parseMetadata: vi.fn(),
  decode: vi.fn(),
  destroy: vi.fn()
}))

vi.mock('./MetadataParser', () => ({ parseMetadata: decoderMocks.parseMetadata }))
vi.mock('./FrameDecoder', () => {
  return {
    FrameDecoder: class {
      decode = decoderMocks.decode
      destroy = decoderMocks.destroy
    }
  }
})

const encoder = new TextEncoder()
const metadata: SceneMetadata = {
  streams: {
    '/path': { type: 'polyline', coordinate: 'world', category: 'path' },
    '/camera': { type: 'image', coordinate: 'ego', category: 'camera' }
  },
  cameras: {},
  totalFrames: 12,
  logInfo: { start_time: 0, end_time: 11 },
  timestamps: new Float32Array([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]),
  statistics: null,
  sceneName: 'fixture',
  sceneDescription: ''
}

const metadataResult: MetadataParseResult = {
  metadata,
  initialStreamState: {},
  staticImageUrls: []
}

function frame(index: number): RawDecodedFrame {
  if (index === 9) {
    return {
      updateType: 'INCREMENTAL',
      timestamp: index,
      egoPose: null,
      patches: {
        '/camera': {
          _raw: 'image',
          bytes: new ArrayBuffer(4),
          mimeType: 'image/png',
          width: 1,
          height: 1
        }
      }
    }
  }

  return {
    updateType: index === 0 ? 'COMPLETE_STATE' : 'INCREMENTAL',
    timestamp: index,
    egoPose: null,
    patches: {
      '/path': {
        _raw: 'polyline',
        vertices: new Float32Array([index, 0, 0, index + 1, 0, 0]),
        offsets: new Uint32Array([0, 2]),
        count: 1
      }
    }
  }
}

function messageIndex(frameCount = 12): ArrayBuffer {
  return encoder.encode(
    JSON.stringify({
      message_format: 'BINARY',
      metadata: 'metadata.glb',
      log_info: { start_time: 0, end_time: frameCount - 1 },
      messages: Array.from({ length: frameCount }, (_, index) => ({
        index,
        timestamp: index,
        file: `messages/${index}.glb`
      }))
    })
  ).buffer
}

function bufferFor(index: number): ArrayBuffer {
  return new Uint8Array([index]).buffer
}

function responseFrom(buffer: ArrayBuffer | Promise<ArrayBuffer>): Response {
  return {
    ok: true,
    status: 200,
    headers: new Headers(),
    body: null,
    arrayBuffer: () => Promise.resolve(buffer)
  } as unknown as Response
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

function frameIndexFromUrl(url: string): number | null {
  const match = /messages\/(\d+)\.glb$/.exec(url)
  return match ? Number(match[1]) : null
}

function installImmediateFetch(frameCount = 12) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input)
    if (url.endsWith('message_index.json')) return responseFrom(messageIndex(frameCount))
    if (url.endsWith('metadata.glb')) return responseFrom(new ArrayBuffer(1))
    const index = frameIndexFromUrl(url)
    if (index === null) throw new Error(`Unexpected URL: ${url}`)
    return responseFrom(bufferFor(index))
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

async function initManager(manager: SceneDataManager): Promise<void> {
  await manager.init()
  await manager.loadFrame(0)
}

beforeEach(() => {
  Object.defineProperty(URL, 'createObjectURL', {
    configurable: true,
    value: vi.fn(() => 'blob:fixture')
  })
  Object.defineProperty(URL, 'revokeObjectURL', {
    configurable: true,
    value: vi.fn()
  })
  decoderMocks.parseMetadata.mockReturnValue(metadataResult)
  decoderMocks.decode.mockImplementation((buffer: ArrayBuffer) => {
    return frame(new Uint8Array(buffer)[0] ?? 0)
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

describe('SceneDataManager', () => {
  it('starts metadata and first-frame downloads in parallel', async () => {
    const metadataBuffer = deferred<ArrayBuffer>()
    const firstFrameBuffer = deferred<ArrayBuffer>()
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.endsWith('message_index.json')) return responseFrom(messageIndex())
      if (url.endsWith('metadata.glb')) return responseFrom(metadataBuffer.promise)
      if (url.endsWith('messages/0.glb')) return responseFrom(firstFrameBuffer.promise)
      throw new Error(`Unexpected URL: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    const manager = new SceneDataManager('/scene/')
    const initPromise = manager.init()

    await vi.waitFor(() => {
      expect(fetchMock.mock.calls.map(([url]) => String(url))).toEqual(
        expect.arrayContaining(['/scene/metadata.glb', '/scene/messages/0.glb'])
      )
    })

    metadataBuffer.resolve(new ArrayBuffer(1))
    await initPromise
    firstFrameBuffer.resolve(bufferFor(0))
    await manager.loadFrame(0)
    manager.destroy()
  })

  it('deduplicates and promotes a queued user request ahead of background prefetch', async () => {
    const pendingFrames = new Map<number, ReturnType<typeof deferred<ArrayBuffer>>>()
    const requestedFrames: number[] = []
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.endsWith('message_index.json')) return responseFrom(messageIndex(6))
      if (url.endsWith('metadata.glb')) return responseFrom(new ArrayBuffer(1))
      const index = frameIndexFromUrl(url)
      if (index === null) throw new Error(`Unexpected URL: ${url}`)
      if (index === 0) return responseFrom(bufferFor(0))
      requestedFrames.push(index)
      const pending = deferred<ArrayBuffer>()
      pendingFrames.set(index, pending)
      return responseFrom(pending.promise)
    })
    vi.stubGlobal('fetch', fetchMock)
    const manager = new SceneDataManager('/scene/')
    await initManager(manager)

    manager.prefetch(0)
    await vi.waitFor(() => expect(requestedFrames).toEqual([1, 2]))
    const critical = manager.loadFrame(5)
    const duplicate = manager.loadFrame(5)

    pendingFrames.get(1)?.resolve(bufferFor(1))
    await vi.waitFor(() => expect(requestedFrames).toEqual([1, 2, 5]))

    pendingFrames.get(5)?.resolve(bufferFor(5))
    await Promise.all([critical, duplicate])
    expect(requestedFrames.filter(frameIndex => frameIndex === 5)).toHaveLength(1)
    manager.destroy()
    for (const [index, pending] of pendingFrames) pending.resolve(bufferFor(index))
  })

  it('revokes every materialized image URL on destroy', async () => {
    installImmediateFetch()
    const manager = new SceneDataManager('/scene/')
    await initManager(manager)
    await manager.loadFrame(9)

    manager.destroy()

    expect(URL.createObjectURL).toHaveBeenCalledTimes(1)
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:fixture')
    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(1)
  })
})
