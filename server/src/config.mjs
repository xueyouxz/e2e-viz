import { readFileSync } from 'node:fs'

function requiredSecret(name) {
  const file = process.env[`${name}_FILE`]
  const value = file ? readFileSync(file, 'utf8').trim() : process.env[name]?.trim()
  if (!value) throw new Error(`${name} or ${name}_FILE is required`)
  return value
}

function positiveInteger(name, defaultValue) {
  const value = Number(process.env[name] ?? defaultValue)
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer`)
  }
  return value
}

function nonNegativeInteger(name, defaultValue) {
  const value = Number(process.env[name] ?? defaultValue)
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${name} must be a non-negative integer`)
  }
  return value
}

export function loadConfig() {
  return {
    host: process.env.HOST?.trim() || '0.0.0.0',
    port: positiveInteger('PORT', 4000),
    oss: {
      region: process.env.OSS_REGION?.trim() || 'oss-cn-shanghai',
      bucket: process.env.OSS_BUCKET?.trim() || 'e2e-viz-private',
      prefix: process.env.OSS_PREFIX?.trim() || 'e2e-viz/data/',
      internal: process.env.OSS_INTERNAL !== 'false',
      accessKeyId: requiredSecret('OSS_ACCESS_KEY_ID'),
      accessKeySecret: requiredSecret('OSS_ACCESS_KEY_SECRET')
    },
    requestTimeoutMs: positiveInteger('OSS_REQUEST_TIMEOUT_MS', 30_000),
    requestDeadlineMs: positiveInteger('OSS_REQUEST_DEADLINE_MS', 55_000),
    initialDataDeadlineMs: positiveInteger('INITIAL_DATA_RESPONSE_DEADLINE_MS', 12_000),
    requestMaxRetries: nonNegativeInteger('OSS_REQUEST_MAX_RETRIES', 2),
    retryBaseDelayMs: positiveInteger('OSS_RETRY_BASE_DELAY_MS', 150),
    dailyRequestLimit: positiveInteger('DAILY_REQUEST_LIMIT', 20_000),
    dailyTransferLimitBytes: positiveInteger('DAILY_TRANSFER_LIMIT_BYTES', 10_737_418_240),
    budgetStateFile: process.env.BUDGET_STATE_FILE?.trim() || null
  }
}
