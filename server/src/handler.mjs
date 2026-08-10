import { pipeline } from 'node:stream/promises'
import { InvalidObjectPathError, resolveObjectName } from './object-path.mjs'

const FORWARDED_RESPONSE_HEADERS = new Set([
  'accept-ranges',
  'content-length',
  'content-range',
  'etag',
  'last-modified'
])

function sendJson(response, statusCode, body) {
  const payload = JSON.stringify(body)
  response.writeHead(statusCode, {
    'Cache-Control': 'no-store',
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(payload),
    'X-Content-Type-Options': 'nosniff'
  })
  response.end(payload)
}

function contentTypeFor(objectName) {
  if (objectName.endsWith('.glb')) return 'model/gltf-binary'
  if (objectName.endsWith('.json')) return 'application/json; charset=utf-8'
  if (objectName.endsWith('.webp')) return 'image/webp'
  return 'application/octet-stream'
}

function cacheControlFor(objectName) {
  return objectName.endsWith('.json')
    ? 'private, max-age=300, must-revalidate'
    : 'private, max-age=86400'
}

function ossRequestHeaders(request) {
  const headers = {}
  for (const name of ['range', 'if-match', 'if-none-match', 'if-modified-since']) {
    const value = request.headers[name]
    if (typeof value === 'string') headers[name] = value
  }
  return headers
}

function applyObjectHeaders(response, objectName, ossHeaders = {}) {
  response.setHeader('Cache-Control', cacheControlFor(objectName))
  response.setHeader('Content-Type', contentTypeFor(objectName))
  response.setHeader('X-Content-Type-Options', 'nosniff')
  for (const [name, value] of Object.entries(ossHeaders)) {
    const normalizedName = name.toLowerCase()
    if (FORWARDED_RESPONSE_HEADERS.has(normalizedName) && value !== undefined) {
      response.setHeader(normalizedName, String(value))
    }
  }
}

function statusFromOssError(error) {
  const status = Number(error?.status ?? error?.statusCode)
  if ([304, 403, 404, 412, 416].includes(status)) return status
  return 502
}

export function createRequestHandler({ ossClient, config, budget, logger = console }) {
  return async function requestHandler(request, response) {
    const url = new URL(request.url ?? '/', 'http://localhost')

    if (url.pathname === '/health') {
      sendJson(response, 200, { status: 'ok' })
      return
    }

    if (request.method !== 'GET' && request.method !== 'HEAD') {
      response.setHeader('Allow', 'GET, HEAD')
      sendJson(response, 405, { error: 'method_not_allowed' })
      return
    }

    let objectName
    try {
      objectName = resolveObjectName(url.pathname, config.oss.prefix)
    } catch (error) {
      if (error instanceof InvalidObjectPathError) {
        sendJson(response, 404, { error: 'not_found' })
        return
      }
      throw error
    }

    let requestAllowed
    try {
      requestAllowed = budget.beginRequest()
    } catch (error) {
      logger.error('Unable to persist request budget', { message: error.message })
      sendJson(response, 503, { error: 'budget_unavailable' })
      return
    }
    if (!requestAllowed) {
      sendJson(response, 429, { error: 'daily_request_limit_reached' })
      return
    }

    try {
      if (request.method === 'HEAD') {
        const result = await ossClient.head(objectName, { timeout: config.requestTimeoutMs })
        applyObjectHeaders(response, objectName, result.res?.headers)
        response.writeHead(result.res?.status ?? 200)
        response.end()
        return
      }

      const result = await ossClient.getStream(objectName, {
        headers: ossRequestHeaders(request),
        timeout: config.requestTimeoutMs
      })
      const contentLength = Number(result.res?.headers?.['content-length'])
      if (!Number.isSafeInteger(contentLength) || contentLength < 0) {
        result.stream.destroy()
        sendJson(response, 502, { error: 'invalid_upstream_response' })
        return
      }
      let transferAllowed
      try {
        transferAllowed = budget.reserveBytes(contentLength)
      } catch (error) {
        result.stream.destroy()
        logger.error('Unable to persist transfer budget', { message: error.message })
        sendJson(response, 503, { error: 'budget_unavailable' })
        return
      }
      if (!transferAllowed) {
        result.stream.destroy()
        sendJson(response, 429, { error: 'daily_transfer_limit_reached' })
        return
      }

      applyObjectHeaders(response, objectName, result.res?.headers)
      response.writeHead(result.res?.status ?? 200)
      response.on('close', () => {
        if (!response.writableEnded) result.stream.destroy()
      })
      await pipeline(result.stream, response)
    } catch (error) {
      if (response.headersSent || response.destroyed) return
      const status = statusFromOssError(error)
      if (status >= 500) {
        logger.error('OSS request failed', {
          code: error?.code,
          status: error?.status,
          requestId: error?.requestId
        })
      }
      sendJson(response, status, { error: status === 404 ? 'not_found' : 'upstream_error' })
    }
  }
}
