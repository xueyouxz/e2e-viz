import http from 'node:http'
import OSS from 'ali-oss'
import { loadConfig } from './src/config.mjs'
import { DailyBudget } from './src/daily-budget.mjs'
import { createRequestHandler } from './src/handler.mjs'

const config = loadConfig()
const ossClient = new OSS({
  region: config.oss.region,
  bucket: config.oss.bucket,
  internal: config.oss.internal,
  secure: true,
  accessKeyId: config.oss.accessKeyId,
  accessKeySecret: config.oss.accessKeySecret
})
const budget = new DailyBudget({
  maxRequests: config.dailyRequestLimit,
  maxBytes: config.dailyTransferLimitBytes,
  stateFile: config.budgetStateFile
})
const server = http.createServer(createRequestHandler({ ossClient, config, budget }))

server.requestTimeout = config.requestTimeoutMs + 5_000
server.headersTimeout = 15_000
server.keepAliveTimeout = 5_000

server.listen(config.port, config.host, () => {
  console.log(`e2e-viz API listening on ${config.host}:${config.port}`)
})

function shutdown(signal) {
  console.log(`${signal} received, shutting down`)
  server.close(error => {
    if (error) {
      console.error(error)
      process.exitCode = 1
    }
  })
}

process.on('SIGTERM', () => shutdown('SIGTERM'))
process.on('SIGINT', () => shutdown('SIGINT'))
