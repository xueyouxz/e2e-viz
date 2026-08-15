import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import {
  buildOssutilOptions,
  collectDirectoryStats,
  etagMatchesMd5,
  formatBytes,
  resolveEndpoint,
  runCommand
} from './sync-data.mjs'

test('formats upload sizes for progress output', () => {
  assert.equal(formatBytes(0), '0 B')
  assert.equal(formatBytes(1024), '1.00 KB')
  assert.equal(formatBytes(8 * 1024 ** 3), '8.00 GB')
})

test('always passes a non-empty endpoint and optional config file to ossutil', () => {
  assert.equal(resolveEndpoint(''), 'https://oss-cn-shanghai.aliyuncs.com')
  assert.equal(resolveEndpoint(undefined), 'https://oss-cn-shanghai.aliyuncs.com')
  assert.deepEqual(
    buildOssutilOptions({
      endpoint: 'https://oss-cn-shanghai.aliyuncs.com',
      configFile: '/tmp/ossutil.conf'
    }),
    ['-e', 'https://oss-cn-shanghai.aliyuncs.com', '-c', '/tmp/ossutil.conf']
  )
})

test('compares the public OSS ETag with the local atlas MD5', () => {
  assert.equal(
    etagMatchesMd5('"07A1AA0901FA17D6E149D32729AC2158"', '07a1aa0901fa17d6e149d32729ac2158'),
    true
  )
  assert.equal(etagMatchesMd5('"different"', '07a1aa0901fa17d6e149d32729ac2158'), false)
})

test('propagates command failures to stop the upload', async () => {
  await assert.rejects(
    runCommand(process.execPath, ['-e', 'process.exit(7)']),
    /exited with code 7/
  )
})

test('counts files and bytes recursively while ignoring .DS_Store', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'e2e-viz-upload-stats-'))
  try {
    mkdirSync(join(directory, 'nested'))
    writeFileSync(join(directory, 'one.bin'), Buffer.alloc(10))
    writeFileSync(join(directory, 'nested', 'two.bin'), Buffer.alloc(20))
    writeFileSync(join(directory, '.DS_Store'), Buffer.alloc(30))

    assert.deepEqual(await collectDirectoryStats(directory), { files: 2, bytes: 30 })
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})
