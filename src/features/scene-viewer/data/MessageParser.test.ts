import { describe, it, expect } from 'vitest'
import { collectTransferables } from './MessageParser'
import type { RawDecodedFrame } from '../types'

function makeFrame(patches: RawDecodedFrame['patches'] = {}): RawDecodedFrame {
  return { updateType: 'COMPLETE_STATE', timestamp: 0, egoPose: null, patches }
}

describe('collectTransferables', () => {
  it('returns empty array for frame with no patches', () => {
    expect(collectTransferables(makeFrame())).toEqual([])
  })

  it('collects point cloud buffers', () => {
    const points = new Float32Array([1, 2, 3])
    const frame = makeFrame({ '/lidar': { _raw: 'point', points, intensity: null } })
    const result = collectTransferables(frame)
    expect(result).toContain(points.buffer)
    expect(result).toHaveLength(1)
  })

  it('collects point cloud intensity buffer when present', () => {
    const points = new Float32Array([1, 2, 3])
    const intensity = new Float32Array([0.5, 0.8, 1.0])
    const frame = makeFrame({ '/lidar': { _raw: 'point', points, intensity } })
    const result = collectTransferables(frame)
    expect(result).toContain(points.buffer)
    expect(result).toContain(intensity.buffer)
    expect(result).toHaveLength(2)
  })

  it('collects polyline buffers', () => {
    const vertices = new Float32Array([0, 0, 0, 1, 1, 1])
    const offsets = new Uint32Array([0, 2])
    const frame = makeFrame({ '/path': { _raw: 'polyline', vertices, offsets, count: 1 } })
    const result = collectTransferables(frame)
    expect(result).toContain(vertices.buffer)
    expect(result).toContain(offsets.buffer)
  })

  it('collects polygon buffers', () => {
    const vertices = new Float32Array([0, 0, 0, 1, 1, 0, 0, 1, 0])
    const offsets = new Uint32Array([0, 3])
    const frame = makeFrame({ '/zone': { _raw: 'polygon', vertices, offsets, count: 1 } })
    const result = collectTransferables(frame)
    expect(result).toContain(vertices.buffer)
    expect(result).toContain(offsets.buffer)
  })

  it('collects cuboid buffers', () => {
    const centers = new Float32Array([0, 0, 0])
    const sizes = new Float32Array([1, 1, 1])
    const rotations = new Float32Array([1, 0, 0, 0])
    const classIds = new Uint32Array([4])
    const frame = makeFrame({
      '/boxes': {
        _raw: 'cuboid',
        centers,
        sizes,
        rotations,
        classIds,
        trackIds: null,
        scores: null,
        count: 1
      }
    })
    const result = collectTransferables(frame)
    expect(result).toContain(centers.buffer)
    expect(result).toContain(sizes.buffer)
    expect(result).toContain(rotations.buffer)
    expect(result).toContain(classIds.buffer)
  })

  it('collects optional trackIds and scores when present', () => {
    const centers = new Float32Array([0, 0, 0])
    const sizes = new Float32Array([1, 1, 1])
    const rotations = new Float32Array([1, 0, 0, 0])
    const classIds = new Uint32Array([4])
    const trackIds = new Uint32Array([42])
    const scores = new Float32Array([0.9])
    const frame = makeFrame({
      '/boxes': { _raw: 'cuboid', centers, sizes, rotations, classIds, trackIds, scores, count: 1 }
    })
    const result = collectTransferables(frame)
    expect(result).toContain(trackIds.buffer)
    expect(result).toContain(scores.buffer)
  })

  it('collects image bytes buffer', () => {
    const bytes = new ArrayBuffer(100)
    const frame = makeFrame({
      '/cam': {
        _raw: 'image',
        bytes,
        mimeType: 'image/jpeg',
        width: 10,
        height: 10,
        bounds: undefined
      }
    })
    const result = collectTransferables(frame)
    expect(result).toContain(bytes)
  })

  it('collects transferables from multiple patches', () => {
    const points = new Float32Array([1, 2, 3])
    const bytes = new ArrayBuffer(50)
    const frame = makeFrame({
      '/lidar': { _raw: 'point', points, intensity: null },
      '/cam': {
        _raw: 'image',
        bytes,
        mimeType: 'image/jpeg',
        width: 5,
        height: 5,
        bounds: undefined
      }
    })
    const result = collectTransferables(frame)
    expect(result).toContain(points.buffer)
    expect(result).toContain(bytes)
    expect(result).toHaveLength(2)
  })
})
