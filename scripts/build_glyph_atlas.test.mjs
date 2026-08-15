import assert from 'node:assert/strict'
import test from 'node:test'
import {
  assertAtlasMetadata,
  atlasPlacement,
  createAtlasPlan,
  parseSceneIndex,
  validateAtlasCoverage
} from './build_glyph_atlas.mjs'

const layout = { columns: 3, rows: 2, cellSize: 12, sourceSize: 10, padding: 1 }

test('parses the numeric id from a glyph filename', () => {
  assert.equal(parseSceneIndex('scene-0034.webp'), 34)
  assert.equal(parseSceneIndex('glyph-atlas-v1.webp'), null)
})

test('maps scene ids to deterministic padded slots', () => {
  assert.deepEqual(atlasPlacement(0, layout), { left: 1, top: 1 })
  assert.deepEqual(atlasPlacement(4, layout), { left: 13, top: 13 })
  assert.equal(atlasPlacement(6, layout), null)
})

test('sorts source files by scene id and rejects duplicate slots', () => {
  assert.deepEqual(createAtlasPlan(['scene-0004.webp', 'scene-0000.webp'], layout), [
    { fileName: 'scene-0000.webp', sceneIndex: 0, left: 1, top: 1 },
    { fileName: 'scene-0004.webp', sceneIndex: 4, left: 13, top: 13 }
  ])

  assert.throws(
    () => createAtlasPlan(['scene-0001.webp', 'scene-0001.webp'], layout),
    /Duplicate glyph atlas slot/
  )
})

test('rejects an atlas that does not cover every projection scene', () => {
  const plan = createAtlasPlan(['scene-0000.webp'], layout)
  assert.doesNotThrow(() => validateAtlasCoverage(plan, ['scene-0000']))
  assert.throws(() => validateAtlasCoverage(plan, ['scene-0000', 'scene-0001']), /scene-0001/)
})

test('validates the generated atlas format and dimensions', () => {
  assert.doesNotThrow(() => assertAtlasMetadata({ format: 'webp', width: 36, height: 24 }, layout))
  assert.throws(
    () => assertAtlasMetadata({ format: 'png', width: 36, height: 24 }, layout),
    /Invalid glyph atlas/
  )
  assert.throws(
    () => assertAtlasMetadata({ format: 'webp', width: 35, height: 24 }, layout),
    /Invalid glyph atlas/
  )
})
