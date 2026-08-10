import { readFileSync, renameSync, writeFileSync } from 'node:fs'

const DAY_MS = 24 * 60 * 60 * 1000

export class DailyBudget {
  #day
  #requests = 0
  #bytes = 0

  constructor({ maxRequests, maxBytes, now = Date.now, stateFile = null }) {
    this.maxRequests = maxRequests
    this.maxBytes = maxBytes
    this.now = now
    this.stateFile = stateFile
    this.#day = this.#currentDay()
    this.#load()
  }

  beginRequest() {
    this.#rollover()
    if (this.#requests >= this.maxRequests) return false
    this.#requests += 1
    this.#persist()
    return true
  }

  reserveBytes(byteCount) {
    this.#rollover()
    if (!Number.isSafeInteger(byteCount) || byteCount < 0) return false
    if (this.#bytes + byteCount > this.maxBytes) return false
    this.#bytes += byteCount
    this.#persist()
    return true
  }

  snapshot() {
    this.#rollover()
    return {
      requests: this.#requests,
      bytes: this.#bytes,
      remainingRequests: Math.max(0, this.maxRequests - this.#requests),
      remainingBytes: Math.max(0, this.maxBytes - this.#bytes)
    }
  }

  #currentDay() {
    return Math.floor(this.now() / DAY_MS)
  }

  #rollover() {
    const currentDay = this.#currentDay()
    if (currentDay === this.#day) return
    this.#day = currentDay
    this.#requests = 0
    this.#bytes = 0
    this.#persist()
  }

  #load() {
    if (!this.stateFile) return
    let state
    try {
      state = JSON.parse(readFileSync(this.stateFile, 'utf8'))
    } catch (error) {
      if (error?.code === 'ENOENT') return
      throw new Error(`Unable to read budget state: ${error.message}`, { cause: error })
    }

    if (
      !Number.isSafeInteger(state.day) ||
      !Number.isSafeInteger(state.requests) ||
      !Number.isSafeInteger(state.bytes) ||
      state.requests < 0 ||
      state.bytes < 0
    ) {
      throw new Error('Budget state is invalid')
    }

    if (state.day === this.#day) {
      this.#requests = state.requests
      this.#bytes = state.bytes
    }
  }

  #persist() {
    if (!this.stateFile) return
    const temporaryFile = `${this.stateFile}.tmp`
    writeFileSync(
      temporaryFile,
      JSON.stringify({ day: this.#day, requests: this.#requests, bytes: this.#bytes }),
      { mode: 0o600 }
    )
    renameSync(temporaryFile, this.stateFile)
  }
}
