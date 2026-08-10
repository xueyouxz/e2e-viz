import assert from 'node:assert/strict'
import http from 'node:http'
import { Readable } from 'node:stream'
import test from 'node:test'
import { DailyBudget } from '../src/daily-budget.mjs'
import { createRequestHandler } from '../src/handler.mjs'

const config = {
  oss: { prefix: 'e2e-viz/data/' },
  requestTimeoutMs: 1_000
}

async function withServer(ossClient, callback) {
  const budget = new DailyBudget({ maxRequests: 10, maxBytes: 1_000 })
  const server = http.createServer(createRequestHandler({ ossClient, config, budget }))
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  try {
    await callback(`http://127.0.0.1:${address.port}`)
  } finally {
    await new Promise((resolve, reject) =>
      server.close(error => (error ? reject(error) : resolve()))
    )
  }
}

test('streams an allow-listed object without exposing OSS details', async () => {
  let requestedObject
  const ossClient = {
    async getStream(name) {
      requestedObject = name
      return {
        stream: Readable.from([Buffer.from('{"ok":true}')]),
        res: {
          status: 200,
          headers: { 'content-length': '11', etag: 'example-etag' }
        }
      }
    }
  }

  await withServer(ossClient, async baseUrl => {
    const response = await fetch(`${baseUrl}/data/projection-map/example.json`)
    assert.equal(response.status, 200)
    assert.equal(response.headers.get('cache-control'), 'private, max-age=300, must-revalidate')
    assert.equal(await response.text(), '{"ok":true}')
  })

  assert.equal(requestedObject, 'e2e-viz/data/projection-map/example.json')
})

test('rejects traversal before calling OSS', async () => {
  const ossClient = {
    async getStream() {
      assert.fail('OSS must not be called for an invalid path')
    }
  }

  await withServer(ossClient, async baseUrl => {
    const response = await fetch(`${baseUrl}/data/scenes/%2e%2e%2fprivate.json`)
    assert.equal(response.status, 404)
  })
})
