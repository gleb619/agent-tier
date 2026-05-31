import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import path from 'path'
import { makeStores } from '../helpers/stores'
import { createAgent, createTask, createRun } from '../../../src/compose/domain'

describe('AgentStore', () => {
  let tmpDir: string
  let store: ReturnType<typeof makeStores>['agents']

  beforeEach(() => {
    tmpDir = mkdtempSync(path.join(tmpdir(), 'compose-test-'))
    store = makeStores('/test/project', tmpDir).agents
  })

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true })
  })

  it('save and get an agent', async () => {
    const agent = createAgent({ name: 'Test', adapter: 'mock' })
    await store.save(agent)
    const got = await store.get(agent.id)
    expect(got).toEqual(agent)
  })

  it('getAll returns all agents', async () => {
    const a1 = createAgent({ name: 'A1', adapter: 'mock' })
    const a2 = createAgent({ name: 'A2', adapter: 'mock' })
    await store.save(a1)
    await store.save(a2)
    const all = await store.getAll()
    expect(all).toHaveLength(2)
    expect(all.map((a) => a.id).sort()).toEqual([a1.id, a2.id].sort())
  })

  it('delete removes agent', async () => {
    const agent = createAgent({ name: 'Test', adapter: 'mock' })
    await store.save(agent)
    await store.delete(agent.id)
    const got = await store.get(agent.id)
    expect(got).toBeUndefined()
  })

  it('getByStatus filters correctly', async () => {
    const idle = createAgent({ name: 'Idle', adapter: 'mock' })
    const running = createAgent({ name: 'Running', adapter: 'mock' })
    running.status = 'running'
    await store.save(idle)
    await store.save(running)
    const result = await store.getByStatus('idle')
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe(idle.id)
  })
})

describe('TaskStore', () => {
  let tmpDir: string
  let store: ReturnType<typeof makeStores>['tasks']

  beforeEach(() => {
    tmpDir = mkdtempSync(path.join(tmpdir(), 'compose-test-'))
    store = makeStores('/test/project', tmpDir).tasks
  })

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true })
  })

  it('save and get a task', async () => {
    const task = createTask({ title: 'Test task' })
    await store.save(task)
    const got = await store.get(task.id)
    expect(got).toEqual(task)
  })

  it('getByStatus filters', async () => {
    const todo = createTask({ title: 'Todo' })
    const done = createTask({ title: 'Done' })
    done.status = 'done'
    await store.save(todo)
    await store.save(done)
    const result = await store.getByStatus('todo')
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe(todo.id)
  })

  it('getByGoal filters', async () => {
    const t1 = createTask({ title: 'T1', goalId: 'g1' })
    const t2 = createTask({ title: 'T2', goalId: 'g2' })
    const t3 = createTask({ title: 'T3' })
    await store.save(t1)
    await store.save(t2)
    await store.save(t3)
    const result = await store.getByGoal('g1')
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe(t1.id)
  })

  it('getByAssignee filters', async () => {
    const t1 = createTask({ title: 'T1' })
    const t2 = createTask({ title: 'T2' })
    t1.assignee = 'agent-a'
    t2.assignee = 'agent-b'
    await store.save(t1)
    await store.save(t2)
    const result = await store.getByAssignee('agent-a')
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe(t1.id)
  })
})

describe('RunStore', () => {
  let tmpDir: string
  let store: ReturnType<typeof makeStores>['runs']

  beforeEach(() => {
    tmpDir = mkdtempSync(path.join(tmpdir(), 'compose-test-'))
    store = makeStores('/test/project', tmpDir).runs
  })

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true })
  })

  it('save and get a run', async () => {
    const run = createRun({ taskId: 't1', agentId: 'a1', attempt: 1, prompt: 'do it' })
    await store.save(run)
    const got = await store.get(run.id)
    expect(got).toEqual(run)
  })

  it('getByTask returns runs for task', async () => {
    const r1 = createRun({ taskId: 't1', agentId: 'a1', attempt: 1, prompt: 'p1' })
    const r2 = createRun({ taskId: 't1', agentId: 'a2', attempt: 2, prompt: 'p2' })
    const r3 = createRun({ taskId: 't2', agentId: 'a1', attempt: 1, prompt: 'p3' })
    await store.save(r1)
    await store.save(r2)
    await store.save(r3)
    const result = await store.getByTask('t1')
    expect(result).toHaveLength(2)
    expect(result.map((r) => r.id).sort()).toEqual([r1.id, r2.id].sort())
  })

  it('getActive returns running/preparing runs', async () => {
    const preparing = createRun({ taskId: 't1', agentId: 'a1', attempt: 1, prompt: 'p1' })
    const running = createRun({ taskId: 't1', agentId: 'a1', attempt: 2, prompt: 'p2' })
    running.status = 'running'
    const succeeded = createRun({ taskId: 't2', agentId: 'a2', attempt: 1, prompt: 'p3' })
    succeeded.status = 'succeeded'
    await store.save(preparing)
    await store.save(running)
    await store.save(succeeded)
    const result = await store.getActive()
    expect(result).toHaveLength(2)
    expect(result.map((r) => r.id).sort()).toEqual([preparing.id, running.id].sort())
  })
})
