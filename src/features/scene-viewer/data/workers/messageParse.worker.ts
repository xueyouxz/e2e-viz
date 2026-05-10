import { parseMessage, collectTransferables } from '../MessageParser'
import type { StreamMeta } from '../../types'
import type { WorkerInMessage, WorkerParseResponse } from './workerMessages'

type WorkerScope = {
  onmessage: ((event: MessageEvent<WorkerInMessage>) => void) | null
  postMessage: (message: WorkerParseResponse, transfer?: Transferable[]) => void
}

const workerSelf = self as unknown as WorkerScope
let streamsMeta: Record<string, StreamMeta> = {}

workerSelf.onmessage = (event: MessageEvent<WorkerInMessage>) => {
  const msg = event.data

  if (msg.type === 'init') {
    streamsMeta = msg.streamsMeta
    return
  }

  const { id, buffer } = msg
  try {
    const frame = parseMessage(buffer, streamsMeta)
    const transferables = collectTransferables(frame)
    const response: WorkerParseResponse = { id, ok: true, frame }
    workerSelf.postMessage(response, transferables)
  } catch (err) {
    const response: WorkerParseResponse = {
      id,
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    }
    workerSelf.postMessage(response)
  }
}
