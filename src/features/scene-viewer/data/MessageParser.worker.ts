import {
  collectTransferables,
  parseFrame,
  type MessageParserRequest,
  type MessageParserResponse
} from './MessageParser'
import type { StreamMeta } from '../types'

type WorkerScope = {
  onmessage: ((event: MessageEvent<MessageParserRequest>) => void) | null
  postMessage: (message: MessageParserResponse, transfer?: Transferable[]) => void
}

const workerScope = self as unknown as WorkerScope
let streamsMeta: Record<string, StreamMeta> | null = null

workerScope.onmessage = (event: MessageEvent<MessageParserRequest>) => {
  const message = event.data
  if (message.type === 'init') {
    streamsMeta = message.streamsMeta
    return
  }

  const { id, buffer } = message
  try {
    if (!streamsMeta) throw new Error('MessageParser Worker not initialized')
    const frame = parseFrame(buffer, streamsMeta)
    workerScope.postMessage({ id, ok: true, frame }, collectTransferables(frame))
  } catch (error) {
    workerScope.postMessage({
      id,
      ok: false,
      error: error instanceof Error ? error.message : String(error)
    })
  }
}
