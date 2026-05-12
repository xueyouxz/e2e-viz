// GLB (glTF 2.0 Binary) reader — DOM-free, safe to run in a Web Worker.

interface GlbAccessor {
  bufferView: number
  byteOffset?: number
  componentType: number
  count: number
  type: string
}

interface GlbBufferView {
  byteOffset: number
  byteLength: number
}

interface GlbImage {
  bufferView: number
  mimeType: string
}

export interface GlbJson {
  accessors: GlbAccessor[]
  bufferViews: GlbBufferView[]
  images?: GlbImage[]
  [key: string]: unknown
}

const GLB_MAGIC = 0x46546c67
const CHUNK_JSON = 0x4e4f534a
const CHUNK_BIN = 0x004e4942

const COMPONENT_TYPE = {
  FLOAT: 5126,
  UNSIGNED_INT: 5125
} as const

const TYPE_COMPONENTS: Record<string, number> = {
  SCALAR: 1,
  VEC2: 2,
  VEC3: 3,
  VEC4: 4,
  MAT2: 4,
  MAT3: 9,
  MAT4: 16
}

export interface GlbData {
  json: GlbJson
  bin: DataView
}

export interface ImageBytes {
  bytes: ArrayBuffer
  mimeType: string
}

export function parseGlb(buffer: ArrayBuffer): GlbData {
  const view = new DataView(buffer)
  let offset = 0

  const magic = view.getUint32(offset, true)
  offset += 4
  if (magic !== GLB_MAGIC) throw new Error(`Invalid GLB magic: 0x${magic.toString(16)}`)
  offset += 4 // version
  offset += 4 // totalLength

  const jsonChunkLength = view.getUint32(offset, true)
  offset += 4
  const jsonChunkType = view.getUint32(offset, true)
  offset += 4
  if (jsonChunkType !== CHUNK_JSON)
    throw new Error(`Expected JSON chunk, got 0x${jsonChunkType.toString(16)}`)

  const jsonText = new TextDecoder().decode(new Uint8Array(buffer, offset, jsonChunkLength))
  const json = JSON.parse(jsonText) as GlbJson
  offset += jsonChunkLength

  let bin: DataView = new DataView(new ArrayBuffer(0))
  if (offset < buffer.byteLength) {
    const binChunkLength = view.getUint32(offset, true)
    offset += 4
    const binChunkType = view.getUint32(offset, true)
    offset += 4
    if (binChunkType === CHUNK_BIN) {
      bin = new DataView(buffer, offset, binChunkLength)
    }
  }

  return { json, bin }
}

export function readAccessor(
  json: GlbJson,
  bin: DataView,
  ref: string
): Float32Array | Uint32Array {
  const idx = parseInt(ref.split('/').pop()!, 10)
  const acc = json.accessors[idx]
  const bv = json.bufferViews[acc.bufferView]
  const componentCount = TYPE_COMPONENTS[acc.type] ?? 1
  const elementCount = acc.count * componentCount
  const accByteOffset = acc.byteOffset ?? 0
  const byteOffset = bin.byteOffset + bv.byteOffset + accByteOffset

  if (acc.componentType === COMPONENT_TYPE.FLOAT) {
    return new Float32Array(bin.buffer, byteOffset, elementCount)
  }
  if (acc.componentType === COMPONENT_TYPE.UNSIGNED_INT) {
    return new Uint32Array(bin.buffer, byteOffset, elementCount)
  }
  const raw = new Uint8Array(bin.buffer, byteOffset, elementCount * 4)
  return new Float32Array(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength))
}

export function readUint8Accessor(json: GlbJson, bin: DataView, ref: string): Uint8Array {
  const idx = parseInt(ref.split('/').pop()!, 10)
  const acc = json.accessors[idx]
  const bv = json.bufferViews[acc.bufferView]
  const componentCount = TYPE_COMPONENTS[acc.type] ?? 1
  const elementCount = acc.count * componentCount
  const accByteOffset = acc.byteOffset ?? 0
  const byteOffset = bin.byteOffset + bv.byteOffset + accByteOffset
  return new Uint8Array(bin.buffer, byteOffset, elementCount)
}

export function readImageBytes(json: GlbJson, bin: DataView, ref: string): ImageBytes {
  const idx = parseInt(ref.split('/').pop()!, 10)
  const imgMeta = json.images?.[idx]
  if (!imgMeta) throw new Error(`Image ${idx} not found in GLB`)
  const bv = json.bufferViews[imgMeta.bufferView]
  const byteOffset = bin.byteOffset + bv.byteOffset
  const imgSrc = new Uint8Array(bin.buffer, byteOffset, bv.byteLength)
  return { bytes: imgSrc.slice().buffer, mimeType: imgMeta.mimeType }
}
