// DOM-free — safe to run in a Web Worker.
import { parseGlb, readAccessor, readImageBytes } from './GlbReader'
import type { GlbJson } from './GlbReader'
import type { EgoPose, RawDecodedFrame, RawStreamPayload, StreamMeta } from '../types'

interface NuvizStateUpdate {
  nuviz: {
    type: string
    data: {
      update_type: 'COMPLETE_STATE' | 'INCREMENTAL'
      updates: Array<{
        timestamp: number
        poses?: Record<string, EgoPose>
        primitives?: Record<string, unknown>
      }>
    }
  }
}

function decodePoint(json: GlbJson, bin: DataView, p: Record<string, unknown>): RawStreamPayload {
  const points = (readAccessor(json, bin, p.points as string) as Float32Array).slice()
  let intensity: Float32Array | null = null
  if (typeof p.INTENSITY === 'string') {
    intensity = (readAccessor(json, bin, p.INTENSITY) as Float32Array).slice()
  }
  return { _raw: 'point', points, intensity }
}

function decodePath(
  json: GlbJson,
  bin: DataView,
  p: Record<string, unknown>,
  streamName: string,
  streamsMeta: Record<string, StreamMeta>
): RawStreamPayload {
  const vertices = (readAccessor(json, bin, p.vertices as string) as Float32Array).slice()
  const offsets = (readAccessor(json, bin, p.offsets as string) as Uint32Array).slice()
  const count = (p.count as number) ?? offsets.length - 1
  const rawType = streamsMeta[streamName]?.type === 'polygon' ? 'polygon' : 'polyline'
  return { _raw: rawType, vertices, offsets, count }
}

function decodeCuboid(json: GlbJson, bin: DataView, p: Record<string, unknown>): RawStreamPayload {
  const centers = (readAccessor(json, bin, p.CENTER as string) as Float32Array).slice()
  const sizes = (readAccessor(json, bin, p.SIZE as string) as Float32Array).slice()
  const rotations = (readAccessor(json, bin, p.ROTATION as string) as Float32Array).slice()
  const classIds = (readAccessor(json, bin, p.CLASS_ID as string) as Uint32Array).slice()
  let trackIds: Uint32Array | null = null
  if (typeof p.TRACK_ID === 'string') {
    trackIds = (readAccessor(json, bin, p.TRACK_ID) as Uint32Array).slice()
  }
  let scores: Float32Array | null = null
  if (typeof p.SCORE === 'string') {
    scores = (readAccessor(json, bin, p.SCORE) as Float32Array).slice()
  }
  const count = p.count as number
  return { _raw: 'cuboid', centers, sizes, rotations, classIds, trackIds, scores, count }
}

function decodeImage(json: GlbJson, bin: DataView, p: Record<string, unknown>): RawStreamPayload {
  const { bytes, mimeType } = readImageBytes(json, bin, p.image as string)
  const bounds =
    p.bounds && typeof p.bounds === 'object' && 'min_x' in p.bounds
      ? (p.bounds as { min_x: number; min_y: number; max_x: number; max_y: number })
      : undefined
  return {
    _raw: 'image',
    bytes,
    mimeType,
    width: (p.width as number) ?? 0,
    height: (p.height as number) ?? 0,
    bounds
  }
}

export function parseMessage(
  buffer: ArrayBuffer,
  streamsMeta: Record<string, StreamMeta> = {}
): RawDecodedFrame {
  const { json, bin } = parseGlb(buffer)
  const root = json as unknown as NuvizStateUpdate
  const { update_type, updates } = root.nuviz.data
  const update = updates[0]

  const egoPose: EgoPose | null = update.poses?.['/ego_pose'] ?? null

  const patches: Record<string, RawStreamPayload> = {}
  const primitives = update.primitives ?? {}

  for (const [streamName, raw] of Object.entries(primitives)) {
    if (!raw || typeof raw !== 'object') continue
    const p = raw as Record<string, unknown>

    try {
      if (typeof p.points === 'string') {
        patches[streamName] = decodePoint(json, bin, p)
      } else if (typeof p.vertices === 'string') {
        patches[streamName] = decodePath(json, bin, p, streamName, streamsMeta)
      } else if (typeof p.CENTER === 'string') {
        patches[streamName] = decodeCuboid(json, bin, p)
      } else if (typeof p.image === 'string') {
        patches[streamName] = decodeImage(json, bin, p)
      }
    } catch {
      // skip malformed stream — don't abort the whole frame
    }
  }

  return {
    updateType: update_type,
    timestamp: update.timestamp,
    egoPose,
    patches
  }
}

export function collectTransferables(frame: RawDecodedFrame): Transferable[] {
  const transferables: Transferable[] = []
  for (const payload of Object.values(frame.patches)) {
    if (payload._raw === 'point') {
      transferables.push(payload.points.buffer)
      if (payload.intensity) transferables.push(payload.intensity.buffer)
    } else if (payload._raw === 'polyline' || payload._raw === 'polygon') {
      transferables.push(payload.vertices.buffer, payload.offsets.buffer)
    } else if (payload._raw === 'cuboid') {
      transferables.push(
        payload.centers.buffer,
        payload.sizes.buffer,
        payload.rotations.buffer,
        payload.classIds.buffer
      )
      if (payload.trackIds) transferables.push(payload.trackIds.buffer)
      if (payload.scores) transferables.push(payload.scores.buffer)
    } else if (payload._raw === 'image') {
      transferables.push(payload.bytes)
    }
  }
  return transferables
}
