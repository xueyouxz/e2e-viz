import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  collectTransferables,
  parseMetadata,
  parseFrame,
  MessageParser,
  MessageParserDestroyedError
} from '../MessageParser'
import type { MessageParserRequest } from '../MessageParser'
import type { ParsedFrame, StreamMeta } from '../../types'

const accessorFixtures = vi.hoisted(() => ({
  vertices: new Float32Array([0, 0, 0, 1, 0, 0, 1, 1, 0]),
  offsets: new Uint32Array([0, 3])
}))

vi.mock('../GlbReader', () => ({
  parseGlb: (buffer: ArrayBuffer) => {
    const isMetadata = new Uint8Array(buffer)[0] === 1
    return {
      json: {
        nuviz: isMetadata
          ? {
              type: 'metadata',
              data: {
                scene_name: 'fixture',
                streams: {
                  '/path': { type: 'polygon', coordinate: 'world', category: 'map' }
                },
                map: {
                  '/path': { vertices: 'vertices', offsets: 'offsets', count: 1 }
                }
              }
            }
          : {
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
    }
  },
  readAccessor: (_json: unknown, _bin: DataView, reference: string) => {
    return reference === 'vertices' ? accessorFixtures.vertices : accessorFixtures.offsets
  },
  readImageBytes: vi.fn(),
  readUint8Accessor: vi.fn()
}))

const polygonMeta: Record<string, StreamMeta> = {
  '/path': { type: 'polygon', coordinate: 'world', category: 'map' }
}
const polylineMeta: Record<string, StreamMeta> = {
  '/path': { type: 'polyline', coordinate: 'world', category: 'path' }
}

function createWorker(respond: (message: MessageParserRequest) => ParsedFrame | Error | null): {
  worker: Worker
  messages: MessageParserRequest[]
  transfers: Transferable[][]
  terminate: ReturnType<typeof vi.fn>
} {
  const messages: MessageParserRequest[] = []
  const transfers: Transferable[][] = []
  const terminate = vi.fn()
  const worker = {
    onmessage: null as ((event: MessageEvent<unknown>) => void) | null,
    onerror: null as ((event: ErrorEvent) => void) | null,
    postMessage(message: MessageParserRequest, transfer: Transferable[] = []) {
      messages.push(message)
      transfers.push(transfer)
      const result = respond(message)
      if (message.type !== 'parse-frame') return
      if (result === null) return
      queueMicrotask(() => {
        worker.onmessage?.({
          data:
            result instanceof Error
              ? { id: message.id, ok: false, error: result.message }
              : { id: message.id, ok: true, frame: result }
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

describe('MessageParser', () => {
  it('parses metadata and frame payloads through the same module', () => {
    const metadata = parseMetadata(new Uint8Array([1]).buffer, 1, {
      start_time: 0,
      end_time: 1
    })
    const frame = parseFrame(new ArrayBuffer(0), metadata.metadata.streams)

    expect(metadata.initialStreamState['/path']?._raw).toBe('polygon')
    expect(frame.patches['/path']?._raw).toBe('polygon')
  })

  it('uses streamsMeta to distinguish polygon from polyline', () => {
    const polygon = parseFrame(new ArrayBuffer(0), polygonMeta)
    const polyline = parseFrame(new ArrayBuffer(0), polylineMeta)

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
      return parseFrame(message.buffer, workerMeta)
    })
    const workerParser = new MessageParser(polygonMeta, () => fake.worker)
    const fallbackParser = new MessageParser(polygonMeta, null)

    const workerInput = new ArrayBuffer(0)
    const workerResult = await workerParser.parseFrame(workerInput)
    const fallbackResult = await fallbackParser.parseFrame(new ArrayBuffer(0))

    expect(fake.messages[0]).toEqual({ type: 'init', streamsMeta: polygonMeta })
    expect(fake.transfers[1]).toEqual([workerInput])
    expect(workerResult).toEqual(fallbackResult)
  })

  it('rejects Worker errors and pending work on destroy', async () => {
    const errorWorker = createWorker(() => new Error('parse failed'))
    const errorParser = new MessageParser(polygonMeta, () => errorWorker.worker)
    await expect(errorParser.parseFrame(new ArrayBuffer(0))).rejects.toThrow('parse failed')

    const pendingWorker = createWorker(() => null)
    const pendingParser = new MessageParser(polygonMeta, () => pendingWorker.worker)
    const pendingParse = pendingParser.parseFrame(new ArrayBuffer(0))
    pendingParser.destroy()

    await expect(pendingParse).rejects.toBeInstanceOf(MessageParserDestroyedError)
    expect(pendingWorker.terminate).toHaveBeenCalledTimes(1)
  })

  it('does not transfer the same underlying ArrayBuffer twice', () => {
    const sharedBuffer = new ArrayBuffer(16)
    const parsedFrame: ParsedFrame = {
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

    expect(collectTransferables(parsedFrame)).toEqual([sharedBuffer])
  })
})
