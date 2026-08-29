import { collectTransferables, decodeFrame } from '../FrameDecoder'
import type { StreamMeta } from '../../types'
import type { FrameDecoderMessage, FrameDecodeResponse } from './frameDecoderMessages'

type WorkerScope = {
  onmessage: ((event: MessageEvent<FrameDecoderMessage>) => void) | null
  postMessage: (message: FrameDecodeResponse, transfer?: Transferable[]) => void
}

const workerScope = self as unknown as WorkerScope
let streamsMeta: Record<string, StreamMeta> | null = null

workerScope.onmessage = (event: MessageEvent<FrameDecoderMessage>) => {
  const message = event.data
  if (message.type === 'init') {
    streamsMeta = message.streamsMeta
    return
  }

  const { id, buffer } = message
  try {
    if (!streamsMeta) throw new Error('FrameDecoder Worker not initialized')
    const decodedFrame = decodeFrame(buffer, streamsMeta)
    const response: FrameDecodeResponse = { id, ok: true, decodedFrame }
    workerScope.postMessage(response, collectTransferables(decodedFrame))
  } catch (error) {
    const response: FrameDecodeResponse = {
      id,
      ok: false,
      error: error instanceof Error ? error.message : String(error)
    }
    workerScope.postMessage(response)
  }
}
