import { describe, expect, it } from 'vitest'
import { parseGlb, readAccessor } from '../GlbReader'
import type { GlbJson } from '../GlbReader'

const GLB_MAGIC = 0x46546c67
const CHUNK_JSON = 0x4e4f534a

function createJsonOnlyGlb(version = 2): ArrayBuffer {
  const encoded = new TextEncoder().encode('{"accessors":[],"bufferViews":[]}')
  const jsonLength = Math.ceil(encoded.byteLength / 4) * 4
  const buffer = new ArrayBuffer(12 + 8 + jsonLength)
  const bytes = new Uint8Array(buffer)
  bytes.fill(0x20, 20)
  bytes.set(encoded, 20)
  const view = new DataView(buffer)
  view.setUint32(0, GLB_MAGIC, true)
  view.setUint32(4, version, true)
  view.setUint32(8, buffer.byteLength, true)
  view.setUint32(12, jsonLength, true)
  view.setUint32(16, CHUNK_JSON, true)
  return buffer
}

describe('GlbReader', () => {
  it('validates the GLB header before parsing chunks', () => {
    expect(parseGlb(createJsonOnlyGlb()).json.accessors).toEqual([])
    expect(() => parseGlb(createJsonOnlyGlb(1))).toThrow('Unsupported GLB version')

    const invalidLength = createJsonOnlyGlb()
    new DataView(invalidLength).setUint32(8, invalidLength.byteLength - 4, true)
    expect(() => parseGlb(invalidLength)).toThrow('Invalid GLB length')
  })

  it('validates accessor references, component types, and byte ranges', () => {
    const bin = new DataView(new Float32Array([3.5]).buffer)
    const json: GlbJson = {
      accessors: [{ bufferView: 0, componentType: 5126, count: 1, type: 'SCALAR' }],
      bufferViews: [{ byteOffset: 0, byteLength: 4 }]
    }

    expect(readAccessor(json, bin, '#/accessors/0')[0]).toBe(3.5)
    expect(() => readAccessor(json, bin, '#/accessors/missing')).toThrow(
      'Invalid accessor reference'
    )

    json.accessors[0].componentType = 5123
    expect(() => readAccessor(json, bin, '#/accessors/0')).toThrow(
      'Unsupported accessor component type'
    )

    json.accessors[0].componentType = 5126
    json.bufferViews[0].byteLength = 2
    expect(() => readAccessor(json, bin, '#/accessors/0')).toThrow('exceeds its buffer bounds')
  })
})
