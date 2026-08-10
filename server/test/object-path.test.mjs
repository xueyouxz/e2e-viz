import assert from 'node:assert/strict'
import test from 'node:test'
import { InvalidObjectPathError, resolveObjectName } from '../src/object-path.mjs'

test('maps a browser data path into the configured OSS prefix', () => {
  assert.equal(
    resolveObjectName('/data/scenes/scene-0916/messages/000001.glb', '/e2e-viz/data'),
    'e2e-viz/data/scenes/scene-0916/messages/000001.glb'
  )
})

test('rejects path traversal and unsupported files', () => {
  for (const path of [
    '/data/scenes/%2e%2e/private.json',
    '/data/scenes/scene-0916/file.exe',
    '/data/scenes/scene-0916%2F..%2Fprivate.json',
    '/data/'
  ]) {
    assert.throws(() => resolveObjectName(path, 'e2e-viz/data/'), InvalidObjectPathError)
  }
})
