import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { InvalidTransitionError } from '../../../src/compose/domain/errors'
import { createTask, type Task, type TaskStatus } from '../../../src/compose/domain/task'
import { createRun, type Run, type RunStatus } from '../../../src/compose/domain/run'
import { createAgent, type Agent, type AgentStatus } from '../../../src/compose/domain/agent'
import {
  canTransitionTask,
  transitionTask,
  canTransitionRun,
  transitionRun,
  canTransitionAgent,
  transitionAgent,
  calculateRetryDelay,
} from '../../../src/compose/domain/transitions'

// ── Task transitions ──────────────────────────────────────────────────────────

describe('canTransitionTask', () => {
  const validPaths: [TaskStatus, TaskStatus][] = [
    ['todo', 'in_progress'],
    ['todo', 'cancelled'],
    ['in_progress', 'review'],
    ['in_progress', 'failed'],
    ['in_progress', 'cancelled'],
    ['review', 'done'],
    ['review', 'failed'],
    ['review', 'retrying'],
    ['retrying', 'todo'],
    ['failed', 'retrying'],
  ]

  it.each(validPaths)('allows %s -> %s', (from, to) => {
    expect(canTransitionTask(from, to)).toBe(true)
  })

  const allStatuses: TaskStatus[] = ['todo', 'in_progress', 'review', 'done', 'failed', 'cancelled', 'retrying']

  it('rejects all invalid transitions', () => {
    const validSet = new Set(validPaths.map(([f, t]) => `${f}->${t}`))
    let invalidCount = 0
    for (const from of allStatuses) {
      for (const to of allStatuses) {
        if (from === to) continue
        if (validSet.has(`${from}->${to}`)) continue
        expect(canTransitionTask(from, to)).toBe(false)
        invalidCount++
      }
    }
    expect(invalidCount).toBeGreaterThan(0)
  })

  it('rejects same-status transitions', () => {
    for (const s of allStatuses) {
      expect(canTransitionTask(s, s)).toBe(false)
    }
  })
})

describe('transitionTask', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  function makeTask(overrides?: Partial<Task>): Task {
    return { ...createTask({ title: 'test' }), ...overrides }
  }

  const allowed: [TaskStatus, TaskStatus][] = [
    ['todo', 'in_progress'],
    ['todo', 'cancelled'],
    ['in_progress', 'review'],
    ['in_progress', 'failed'],
    ['in_progress', 'cancelled'],
    ['review', 'done'],
    ['review', 'failed'],
    ['review', 'retrying'],
    ['retrying', 'todo'],
  ]

  it.each(allowed)('returns new task with status %s -> %s', (from, to) => {
    const task = makeTask({ status: from })
    vi.advanceTimersByTime(1)
    const result = transitionTask(task, to)
    expect(result.status).toBe(to)
    expect(result).not.toBe(task)
    expect(result.updatedAt).not.toBe(task.updatedAt)
  })

  it('increments attempts when retrying', () => {
    const task = makeTask({ status: 'review', attempts: 2 })
    const retrying = transitionTask(task, 'retrying')
    expect(retrying.attempts).toBe(3)
  })

  it('does not increment attempts on non-retry transitions', () => {
    const task = makeTask({ status: 'todo', attempts: 1 })
    const result = transitionTask(task, 'in_progress')
    expect(result.attempts).toBe(1)
  })

  it('updates updatedAt', () => {
    const task = makeTask({ status: 'todo' })
    const before = task.updatedAt
    vi.advanceTimersByTime(1)
    const result = transitionTask(task, 'in_progress')
    expect(result.updatedAt).not.toBe(before)
  })

  it('does not mutate original object', () => {
    const task = makeTask({ status: 'todo' })
    const snapshot = { ...task }
    transitionTask(task, 'in_progress')
    expect(task).toEqual(snapshot)
  })

  it('allows failed -> retrying when attempts < maxAttempts', () => {
    const task = makeTask({ status: 'failed', attempts: 2, maxAttempts: 3 })
    const result = transitionTask(task, 'retrying')
    expect(result.status).toBe('retrying')
    expect(result.attempts).toBe(3)
  })

  it('throws on failed -> retrying when attempts >= maxAttempts', () => {
    const task = makeTask({ status: 'failed', attempts: 3, maxAttempts: 3 })
    expect(() => transitionTask(task, 'retrying')).toThrow(InvalidTransitionError)
  })

  it('throws on invalid transition', () => {
    const task = makeTask({ status: 'done' })
    expect(() => transitionTask(task, 'todo')).toThrow(InvalidTransitionError)
  })

  it('InvalidTransitionError has correct from/to', () => {
    const task = makeTask({ status: 'done' })
    try {
      transitionTask(task, 'in_progress')
      expect.unreachable('should have thrown')
    } catch (e) {
      expect(e).toBeInstanceOf(InvalidTransitionError)
      const err = e as InvalidTransitionError
      expect(err.from).toBe('done')
      expect(err.to).toBe('in_progress')
    }
  })
})

// ── Run transitions ───────────────────────────────────────────────────────────

describe('canTransitionRun', () => {
  const validPaths: [RunStatus, RunStatus][] = [
    ['preparing', 'running'],
    ['preparing', 'cancelled'],
    ['running', 'succeeded'],
    ['running', 'failed'],
    ['running', 'timed_out'],
    ['running', 'cancelled'],
  ]

  it.each(validPaths)('allows %s -> %s', (from, to) => {
    expect(canTransitionRun(from, to)).toBe(true)
  })

  const allStatuses: RunStatus[] = ['preparing', 'running', 'succeeded', 'failed', 'timed_out', 'cancelled']

  it('rejects all invalid transitions', () => {
    const validSet = new Set(validPaths.map(([f, t]) => `${f}->${t}`))
    for (const from of allStatuses) {
      for (const to of allStatuses) {
        if (from === to) continue
        if (validSet.has(`${from}->${to}`)) continue
        expect(canTransitionRun(from, to)).toBe(false)
      }
    }
  })
})

describe('transitionRun', () => {
  function makeRun(overrides?: Partial<Run>): Run {
    return { ...createRun({ taskId: 't1', agentId: 'a1', attempt: 1, prompt: 'do it' }), ...overrides }
  }

  const allowed: [RunStatus, RunStatus][] = [
    ['preparing', 'running'],
    ['preparing', 'cancelled'],
    ['running', 'succeeded'],
    ['running', 'failed'],
    ['running', 'timed_out'],
    ['running', 'cancelled'],
  ]

  it.each(allowed)('returns new run with status %s -> %s', (from, to) => {
    const run = makeRun({ status: from })
    const result = transitionRun(run, to)
    expect(result.status).toBe(to)
    expect(result).not.toBe(run)
  })

  it('merges extra fields', () => {
    const run = makeRun({ status: 'running' })
    const finishedAt = new Date().toISOString()
    const result = transitionRun(run, 'succeeded', {
      finishedAt,
      tokenUsage: { prompt: 10, completion: 20, total: 30 },
    })
    expect(result.finishedAt).toBe(finishedAt)
    expect(result.tokenUsage).toEqual({ prompt: 10, completion: 20, total: 30 })
  })

  it('does not mutate original', () => {
    const run = makeRun({ status: 'preparing' })
    const snapshot = { ...run }
    transitionRun(run, 'running')
    expect(run).toEqual(snapshot)
  })

  it('throws on invalid transition', () => {
    const run = makeRun({ status: 'succeeded' })
    expect(() => transitionRun(run, 'running')).toThrow(InvalidTransitionError)
  })
})

// ── Agent transitions ─────────────────────────────────────────────────────────

describe('canTransitionAgent', () => {
  const validPaths: [AgentStatus, AgentStatus][] = [
    ['idle', 'running'],
    ['idle', 'disabled'],
    ['running', 'idle'],
    ['running', 'error'],
    ['error', 'idle'],
    ['error', 'disabled'],
    ['disabled', 'idle'],
  ]

  it.each(validPaths)('allows %s -> %s', (from, to) => {
    expect(canTransitionAgent(from, to)).toBe(true)
  })

  const allStatuses: AgentStatus[] = ['idle', 'running', 'error', 'disabled']

  it('rejects all invalid transitions', () => {
    const validSet = new Set(validPaths.map(([f, t]) => `${f}->${t}`))
    for (const from of allStatuses) {
      for (const to of allStatuses) {
        if (from === to) continue
        if (validSet.has(`${from}->${to}`)) continue
        expect(canTransitionAgent(from, to)).toBe(false)
      }
    }
  })
})

describe('transitionAgent', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  function makeAgent(overrides?: Partial<Agent>): Agent {
    return { ...createAgent({ name: 'test', adapter: 'test' }), ...overrides }
  }

  const allowed: [AgentStatus, AgentStatus][] = [
    ['idle', 'running'],
    ['idle', 'disabled'],
    ['running', 'idle'],
    ['running', 'error'],
    ['error', 'idle'],
    ['error', 'disabled'],
    ['disabled', 'idle'],
  ]

  it.each(allowed)('returns new agent with status %s -> %s', (from, to) => {
    const agent = makeAgent({ status: from })
    vi.advanceTimersByTime(1)
    const result = transitionAgent(agent, to)
    expect(result.status).toBe(to)
    expect(result).not.toBe(agent)
    expect(result.updatedAt).not.toBe(agent.updatedAt)
  })

  it('updates updatedAt', () => {
    const agent = makeAgent({ status: 'idle' })
    const before = agent.updatedAt
    vi.advanceTimersByTime(1)
    const result = transitionAgent(agent, 'running')
    expect(result.updatedAt).not.toBe(before)
  })

  it('does not mutate original', () => {
    const agent = makeAgent({ status: 'idle' })
    const snapshot = { ...agent }
    transitionAgent(agent, 'running')
    expect(agent).toEqual(snapshot)
  })

  it('throws on invalid transition', () => {
    const agent = makeAgent({ status: 'disabled' })
    expect(() => transitionAgent(agent, 'running')).toThrow(InvalidTransitionError)
  })
})

// ── Retry delay ───────────────────────────────────────────────────────────────

describe('calculateRetryDelay', () => {
  it('returns value within [baseMs * 2^attempt, maxMs] for defaults', () => {
    const attempt = 3
    const result = calculateRetryDelay(attempt)
    const min = 1000 * Math.pow(2, attempt) // 8000
    expect(result).toBeGreaterThanOrEqual(min)
    expect(result).toBeLessThanOrEqual(60000)
    // jitter adds at most baseMs=1000, so max is min+1000=9000
    expect(result).toBeLessThan(min + 1000)
  })

  it('attempt=0 returns value in [baseMs, baseMs * 2)', () => {
    for (let i = 0; i < 50; i++) {
      const result = calculateRetryDelay(0)
      expect(result).toBeGreaterThanOrEqual(1000)
      expect(result).toBeLessThan(2000)
    }
  })

  it('respects custom baseMs', () => {
    const result = calculateRetryDelay(1, 500)
    // 500 * 2^1 = 1000, jitter in [0, 500), so [1000, 1500)
    expect(result).toBeGreaterThanOrEqual(1000)
    expect(result).toBeLessThan(1500)
  })

  it('respects custom maxMs', () => {
    const result = calculateRetryDelay(20, 1000, 5000)
    // 1000 * 2^20 is huge, but capped at 5000
    expect(result).toBe(5000)
  })

  it('respects both custom baseMs and maxMs', () => {
    const result = calculateRetryDelay(2, 200, 1000)
    // 200 * 4 = 800, jitter in [0, 200), so [800, 1000), capped at 1000
    expect(result).toBeGreaterThanOrEqual(800)
    expect(result).toBeLessThanOrEqual(1000)
  })

  it('caps at maxMs for large attempts', () => {
    const result = calculateRetryDelay(100, 1000, 30000)
    expect(result).toBe(30000)
  })
})
