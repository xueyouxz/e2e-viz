import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  collectTransferables,
  decodeFrame,
  FrameDecoder,
  FrameDecoderDestroyedError
} from './FrameDecoder'
import type { FrameDecoderMessage } from './workers/frameDecoderMessages'
import type { RawDecodedFrame, StreamMeta } from '../types'

const accessorFixtures = vi.hoisted(() => ({
  vertices: new Float32Array([0, 0, 0, 1, 0, 0, 1, 1, 0]),
  offsets: new Uint32Array([0, 3])
}))

vi.mock('./GlbReader', () => ({
  parseGlb: () => ({
    json: {
      nuviz: {
        type: 'state_update',
        data: {
          update_type: 'COMPLETE_STATE',
          updates: [
            {
              timestamp: 1,
              primitives: {
                '/path': { vertices: 'vertices', offsets: 'offsets', count: 1 }
              }
            }
          ]
        }
      }
    },
    bin: new DataView(new ArrayBuffer(0))
  }),
  readAccessor: (_json: unknown, _bin: DataView, reference: string) => {
    return reference === 'vertices' ? accessorFixtures.vertices : accessorFixtures.offsets
  },
  readImageBytes: vi.fn()
}))

const polygonMeta: Record<string, StreamMeta> = {
  '/path': { type: 'polygon', coordinate: 'world', category: 'map' }
}
const polylineMeta: Record<string, StreamMeta> = {
  '/path': { type: 'polyline', coordinate: 'world', category: 'path' }
}

function createWorker(respond: (message: FrameDecoderMessage) => RawDecodedFrame | Error | null): {
  worker: Worker
  messages: FrameDecoderMessage[]
  transfers: Transferable[][]
  terminate: ReturnType<typeof vi.fn>
} {
  const messages: FrameDecoderMessage[] = []
  const transfers: Transferable[][] = []
  const terminate = vi.fn()
  const worker = {
    onmessage: null as ((event: MessageEvent<unknown>) => void) | null,
    onerror: null as ((event: ErrorEvent) => void) | null,
    postMessage(message: FrameDecoderMessage, transfer: Transferable[] = []) {
      messages.push(message)
      transfers.push(transfer)
      const result = respond(message)
      if (message.type !== 'decode') return
      if (result === null) return
      queueMicrotask(() => {
        worker.onmessage?.({
          data:
            result instanceof Error
              ? { id: message.id, ok: false, error: result.message }
              : { id: message.id, ok: true, decodedFrame: result }
        } as MessageEvent<unknown>)
      })
    },
    terminate
  }
  return { worker: worker as unknown as Worker, messages, transfers, terminate }
}

afterEach(() => {
  vi.clearAllMocks()
})

describe('FrameDecoder', () => {
  it('uses streamsMeta to distinguish polygon from polyline', () => {
    const polygon = decodeFrame(new ArrayBuffer(0), polygonMeta)
    const polyline = decodeFrame(new ArrayBuffer(0), polylineMeta)

    expect(polygon.patches['/path']?._raw).toBe('polygon')
    expect(polyline.patches['/path']?._raw).toBe('polyline')
  })

  it('keeps Worker and main-thread adapter output identical', async () => {
    let workerMeta: Record<string, StreamMeta> = {}
    const fake = createWorker(message => {
      if (message.type === 'init') {
        workerMeta = message.streamsMeta
        return null
      }
      return decodeFrame(message.buffer, workerMeta)
    })
    const workerDecoder = new FrameDecoder(polygonMeta, () => fake.worker)
    const fallbackDecoder = new FrameDecoder(polygonMeta, null)

    const workerInput = new ArrayBuffer(0)
    const workerResult = await workerDecoder.decode(workerInput)
    const fallbackResult = await fallbackDecoder.decode(new ArrayBuffer(0))

    expect(fake.messages[0]).toEqual({ type: 'init', streamsMeta: polygonMeta })
    expect(fake.transfers[1]).toEqual([workerInput])
    expect(workerResult).toEqual(fallbackResult)
  })

  it('rejects Worker errors and pending work on destroy', async () => {
    const errorWorker = createWorker(() => new Error('decode failed'))
    const errorDecoder = new FrameDecoder(polygonMeta, () => errorWorker.worker)
    await expect(errorDecoder.decode(new ArrayBuffer(0))).rejects.toThrow('decode failed')

    const pendingWorker = createWorker(() => null)
    const pendingDecoder = new FrameDecoder(polygonMeta, () => pendingWorker.worker)
    const pendingDecode = pendingDecoder.decode(new ArrayBuffer(0))
    pendingDecoder.destroy()

    await expect(pendingDecode).rejects.toBeInstanceOf(FrameDecoderDestroyedError)
    expect(pendingWorker.terminate).toHaveBeenCalledTimes(1)
  })

  it('does not transfer the same underlying ArrayBuffer twice', () => {
    const sharedBuffer = new ArrayBuffer(16)
    const decodedFrame: RawDecodedFrame = {
      updateType: 'COMPLETE_STATE',
      timestamp: 0,
      egoPose: null,
      patches: {
        '/lidar': {
          _raw: 'point',
          points: new Float32Array(sharedBuffer, 0, 2),
          intensity: new Float32Array(sharedBuffer, 8, 2)
        }
      }
    }

    expect(collectTransferables(decodedFrame)).toEqual([sharedBuffer])
  })
})
