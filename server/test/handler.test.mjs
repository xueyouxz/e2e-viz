import assert from 'node:assert/strict'
import http from 'node:http'
import { PassThrough, Readable } from 'node:stream'
import test from 'node:test'
import { DailyBudget } from '../src/daily-budget.mjs'
import { createRequestHandler } from '../src/handler.mjs'

const config = {
  oss: { prefix: 'e2e-viz/data/' },
  requestTimeoutMs: 1_000,
  requestDeadlineMs: 5_000,
  initialDataDeadlineMs: 5_000,
  requestMaxRetries: 2,
  retryBaseDelayMs: 1
}

async function withServer(ossClient, callback, configOverrides = {}) {
  const budget = new DailyBudget({ maxRequests: 10, maxBytes: 1_000 })
  const server = http.createServer(
    createRequestHandler({ ossClient, config: { ...config, ...configOverrides }, budget })
  )
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

test('allows shared caches to retain stable projection metadata', async () => {
  const ossClient = {
    async getStream() {
      return {
        stream: Readable.from([Buffer.from('{"ok":true}')]),
        res: {
          status: 200,
          headers: { 'content-length': '11', etag: 'projection-etag' }
        }
      }
    }
  }

  await withServer(ossClient, async baseUrl => {
    const response = await fetch(`${baseUrl}/data/projection-map/dimension_reduction.json`)
    assert.equal(
      response.headers.get('cache-control'),
      'public, max-age=300, stale-while-revalidate=3600, stale-if-error=86400'
    )
  })
})

test('allows shared caches to retain the versioned glyph atlas', async () => {
  const ossClient = {
    async getStream() {
      return {
        stream: Readable.from([Buffer.from('atlas-bytes')]),
        res: {
          status: 200,
          headers: { 'content-length': '11', etag: 'atlas-etag' }
        }
      }
    }
  }

  await withServer(ossClient, async baseUrl => {
    const response = await fetch(`${baseUrl}/data/glyphs/glyph-atlas-v1.webp`)
    assert.equal(
      response.headers.get('cache-control'),
      'public, max-age=86400, stale-while-revalidate=604800, stale-if-error=604800'
    )
  })
})

test('forwards an OSS not-modified response without requiring a content length', async () => {
  let requestedHeaders
  const ossClient = {
    async getStream(_name, options) {
      requestedHeaders = options.headers
      return {
        stream: Readable.from([]),
        res: {
          status: 304,
          headers: { etag: 'example-etag' }
        }
      }
    }
  }

  await withServer(ossClient, async baseUrl => {
    const response = await fetch(`${baseUrl}/data/projection-map/example.json`, {
      headers: { 'If-None-Match': 'example-etag' }
    })

    assert.equal(response.status, 304)
    assert.equal(await response.text(), '')
  })

  assert.equal(requestedHeaders['if-none-match'], 'example-etag')
})

test('retries a temporary OSS connection failure before responding', async () => {
  let attempts = 0
  const ossClient = {
    async getStream() {
      attempts += 1
      if (attempts === 1) {
        throw Object.assign(new Error('socket reset'), { code: 'ECONNRESET' })
      }
      return {
        stream: Readable.from([Buffer.from('{"ok":true}')]),
        res: {
          status: 200,
          headers: { 'content-length': '11' }
        }
      }
    }
  }

  await withServer(ossClient, async baseUrl => {
    const response = await fetch(`${baseUrl}/data/projection-map/example.json`)
    assert.equal(response.status, 200)
    assert.equal(await response.text(), '{"ok":true}')
  })

  assert.equal(attempts, 2)
})

test('caps an OSS attempt at the total response deadline', async () => {
  let upstreamTimeout
  const ossClient = {
    async getStream(_name, options) {
      upstreamTimeout = options.timeout
      return {
        stream: Readable.from([Buffer.from('{}')]),
        res: { status: 200, headers: { 'content-length': '2' } }
      }
    }
  }

  await withServer(
    ossClient,
    async baseUrl => {
      const response = await fetch(`${baseUrl}/data/projection-map/dimension_reduction.json`)
      assert.equal(response.status, 200)
    },
    { requestTimeoutMs: 1_000, initialDataDeadlineMs: 50 }
  )

  assert.ok(upstreamTimeout > 0 && upstreamTimeout <= 50)
})

test('terminates an OSS body stream at the total response deadline', async () => {
  const upstream = new PassThrough()
  const ossClient = {
    async getStream() {
      return {
        stream: upstream,
        res: { status: 200, headers: { 'content-length': '2' } }
      }
    }
  }

  await withServer(
    ossClient,
    async baseUrl => {
      await assert.rejects(
        fetch(`${baseUrl}/data/projection-map/dimension_reduction.json`).then(response =>
          response.text()
        )
      )
    },
    { initialDataDeadlineMs: 30 }
  )

  assert.equal(upstream.destroyed, true)
})

test('does not apply the initial-data body deadline to scene assets', async () => {
  const upstream = new PassThrough()
  const ossClient = {
    async getStream() {
      setTimeout(() => upstream.end('ok'), 40)
      return {
        stream: upstream,
        res: { status: 200, headers: { 'content-length': '2' } }
      }
    }
  }

  await withServer(
    ossClient,
    async baseUrl => {
      const response = await fetch(`${baseUrl}/data/scenes/scene-0001/sample.glb`)
      assert.equal(await response.text(), 'ok')
    },
    { initialDataDeadlineMs: 10, requestDeadlineMs: 100 }
  )
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
