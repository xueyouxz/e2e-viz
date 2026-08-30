// GLB (glTF 2.0 Binary) reader — DOM-free, safe to run in a Web Worker.

interface GlbAccessor {
  bufferView: number
  byteOffset?: number
  componentType: number
  count: number
  type: string
}

interface GlbBufferView {
  byteOffset?: number
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
  UNSIGNED_INT: 5125,
  UNSIGNED_BYTE: 5121
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

function assertRange(
  totalLength: number,
  byteOffset: number,
  byteLength: number,
  label: string
): void {
  if (
    !Number.isSafeInteger(byteOffset) ||
    !Number.isSafeInteger(byteLength) ||
    byteOffset < 0 ||
    byteLength < 0 ||
    byteOffset + byteLength > totalLength
  ) {
    throw new Error(`${label} exceeds its buffer bounds`)
  }
}

function parseReferenceIndex(ref: string, collectionName: string): number {
  const segment = ref.split('/').at(-1)
  if (!segment || !/^\d+$/.test(segment)) {
    throw new Error(`Invalid ${collectionName} reference: ${ref}`)
  }
  return Number(segment)
}

function resolveBufferRange(
  json: GlbJson,
  bin: DataView,
  bufferViewIndex: number,
  innerByteOffset: number,
  byteLength: number,
  label: string
): number {
  const bufferView = json.bufferViews?.[bufferViewIndex]
  if (!bufferView) throw new Error(`${label} bufferView ${bufferViewIndex} not found`)
  const bufferViewOffset = bufferView.byteOffset ?? 0
  assertRange(bufferView.byteLength, innerByteOffset, byteLength, label)
  assertRange(bin.byteLength, bufferViewOffset + innerByteOffset, byteLength, label)
  return bin.byteOffset + bufferViewOffset + innerByteOffset
}

export function parseGlb(buffer: ArrayBuffer): GlbData {
  if (buffer.byteLength < 12) throw new Error('GLB header is truncated')
  const view = new DataView(buffer)
  let offset = 0

  const magic = view.getUint32(offset, true)
  offset += 4
  if (magic !== GLB_MAGIC) throw new Error(`Invalid GLB magic: 0x${magic.toString(16)}`)
  const version = view.getUint32(offset, true)
  offset += 4
  if (version !== 2) throw new Error(`Unsupported GLB version: ${version}`)
  const totalLength = view.getUint32(offset, true)
  offset += 4
  if (totalLength !== buffer.byteLength) {
    throw new Error(`Invalid GLB length: header=${totalLength}, actual=${buffer.byteLength}`)
  }

  assertRange(buffer.byteLength, offset, 8, 'GLB JSON chunk header')
  const jsonChunkLength = view.getUint32(offset, true)
  offset += 4
  const jsonChunkType = view.getUint32(offset, true)
  offset += 4
  if (jsonChunkType !== CHUNK_JSON)
    throw new Error(`Expected JSON chunk, got 0x${jsonChunkType.toString(16)}`)

  assertRange(buffer.byteLength, offset, jsonChunkLength, 'GLB JSON chunk')
  const jsonText = new TextDecoder().decode(new Uint8Array(buffer, offset, jsonChunkLength))
  const json = JSON.parse(jsonText) as GlbJson
  offset += jsonChunkLength

  let bin: DataView = new DataView(new ArrayBuffer(0))
  if (offset < buffer.byteLength) {
    assertRange(buffer.byteLength, offset, 8, 'GLB BIN chunk header')
    const binChunkLength = view.getUint32(offset, true)
    offset += 4
    const binChunkType = view.getUint32(offset, true)
    offset += 4
    if (binChunkType !== CHUNK_BIN)
      throw new Error(`Expected BIN chunk, got 0x${binChunkType.toString(16)}`)
    assertRange(buffer.byteLength, offset, binChunkLength, 'GLB BIN chunk')
    bin = new DataView(buffer, offset, binChunkLength)
  }

  return { json, bin }
}

export function readAccessor(
  json: GlbJson,
  bin: DataView,
  ref: string
): Float32Array | Uint32Array {
  const idx = parseReferenceIndex(ref, 'accessor')
  const acc = json.accessors?.[idx]
  if (!acc) throw new Error(`Accessor ${idx} not found in GLB`)
  const componentCount = TYPE_COMPONENTS[acc.type]
  if (!componentCount) throw new Error(`Unsupported accessor type: ${acc.type}`)
  if (!Number.isSafeInteger(acc.count) || acc.count < 0) {
    throw new Error(`Invalid accessor count: ${acc.count}`)
  }
  const elementCount = acc.count * componentCount
  const accByteOffset = acc.byteOffset ?? 0
  const byteLength = elementCount * 4
  const byteOffset = resolveBufferRange(
    json,
    bin,
    acc.bufferView,
    accByteOffset,
    byteLength,
    `Accessor ${idx}`
  )
  if (byteOffset % 4 !== 0) throw new Error(`Accessor ${idx} is not 4-byte aligned`)

  if (acc.componentType === COMPONENT_TYPE.FLOAT) {
    return new Float32Array(bin.buffer, byteOffset, elementCount)
  }
  if (acc.componentType === COMPONENT_TYPE.UNSIGNED_INT) {
    return new Uint32Array(bin.buffer, byteOffset, elementCount)
  }
  throw new Error(`Unsupported accessor component type: ${acc.componentType}`)
}

export function readUint8Accessor(json: GlbJson, bin: DataView, ref: string): Uint8Array {
  const idx = parseReferenceIndex(ref, 'accessor')
  const acc = json.accessors?.[idx]
  if (!acc) throw new Error(`Accessor ${idx} not found in GLB`)
  if (acc.componentType !== COMPONENT_TYPE.UNSIGNED_BYTE) {
    throw new Error(`Accessor ${idx} is not an unsigned byte accessor`)
  }
  const componentCount = TYPE_COMPONENTS[acc.type]
  if (!componentCount) throw new Error(`Unsupported accessor type: ${acc.type}`)
  if (!Number.isSafeInteger(acc.count) || acc.count < 0) {
    throw new Error(`Invalid accessor count: ${acc.count}`)
  }
  const elementCount = acc.count * componentCount
  const accByteOffset = acc.byteOffset ?? 0
  const byteOffset = resolveBufferRange(
    json,
    bin,
    acc.bufferView,
    accByteOffset,
    elementCount,
    `Accessor ${idx}`
  )
  return new Uint8Array(bin.buffer, byteOffset, elementCount)
}

export function readImageBytes(json: GlbJson, bin: DataView, ref: string): ImageBytes {
  const idx = parseReferenceIndex(ref, 'image')
  const imgMeta = json.images?.[idx]
  if (!imgMeta) throw new Error(`Image ${idx} not found in GLB`)
  const bufferView = json.bufferViews?.[imgMeta.bufferView]
  if (!bufferView) throw new Error(`Image ${idx} bufferView ${imgMeta.bufferView} not found`)
  const byteOffset = resolveBufferRange(
    json,
    bin,
    imgMeta.bufferView,
    0,
    bufferView.byteLength,
    `Image ${idx}`
  )
  const imgSrc = new Uint8Array(bin.buffer, byteOffset, bufferView.byteLength)
  return { bytes: imgSrc.slice().buffer, mimeType: imgMeta.mimeType }
}
