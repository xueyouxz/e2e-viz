import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { DailyBudget } from '../src/daily-budget.mjs'

test('enforces request and transfer limits', () => {
  const budget = new DailyBudget({ maxRequests: 2, maxBytes: 100 })

  assert.equal(budget.beginRequest(), true)
  assert.equal(budget.beginRequest(), true)
  assert.equal(budget.beginRequest(), false)
  assert.equal(budget.reserveBytes(60), true)
  assert.equal(budget.reserveBytes(41), false)
  assert.deepEqual(budget.snapshot(), {
    requests: 2,
    bytes: 60,
    remainingRequests: 0,
    remainingBytes: 40
  })
})

test('resets counters on the next UTC day', () => {
  let now = 0
  const budget = new DailyBudget({ maxRequests: 1, maxBytes: 10, now: () => now })

  assert.equal(budget.beginRequest(), true)
  assert.equal(budget.reserveBytes(10), true)
  now = 24 * 60 * 60 * 1000
  assert.equal(budget.beginRequest(), true)
  assert.equal(budget.reserveBytes(10), true)
})

test('keeps counters across process restarts', () => {
  const directory = mkdtempSync(join(tmpdir(), 'e2e-viz-budget-'))
  const stateFile = join(directory, 'budget.json')
  try {
    const first = new DailyBudget({ maxRequests: 2, maxBytes: 100, stateFile })
    assert.equal(first.beginRequest(), true)
    assert.equal(first.reserveBytes(60), true)

    const restarted = new DailyBudget({ maxRequests: 2, maxBytes: 100, stateFile })
    assert.deepEqual(restarted.snapshot(), {
      requests: 1,
      bytes: 60,
      remainingRequests: 1,
      remainingBytes: 40
    })
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})
