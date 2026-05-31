import { describe, it, expect } from 'vitest'
import { EventBus } from '../../../src/compose/application/event-bus'
import { createAgent, createTask, createRun } from '../../../src/compose/domain'
import type { Agent, Task, Run } from '../../../src/compose/domain'
import type { IAgentStore, ITaskStore, IRunStore, IGoalStore } from '../../../src/compose/application/ports'
import type { IAgentAdapter, IProcessManager, IWorkspaceManager } from '../../../src/compose/application/ports'
import { Orchestrator } from '../../../src/compose/application/orchestrator'
import { AgentService } from '../../../src/compose/application/services/agent-service'
import { TaskService } from '../../../src/compose/application/services/task-service'
import { RunService } from '../../../src/compose/application/services/run-service'
import { GoalService } from '../../../src/compose/application/services/goal-service'

// ── Fake stores ────────────────────────────────────────────────────────────────

interface FakeAgentStore extends IAgentStore { agents: Map<string, Agent> }
interface FakeTaskStore extends ITaskStore { tasks: Map<string, Task> }
interface FakeRunStore extends IRunStore { runs: Map<string, Run> }
interface FakeGoalStore extends IGoalStore { goals: Map<string, unknown> }

function makeFakeAgentStore(agents: Agent[] = []): FakeAgentStore {
  const map = new Map(agents.map(a => [a.id, a]))
  return {
    agents: map,
    async get(id) { return map.get(id) ?? undefined },
    async getAll() { return [...map.values()] },
    async save(a) { map.set(a.id, a) },
    async delete(id) { map.delete(id) },
    async getByStatus(s) { return [...map.values()].filter(a => a.status === s) },
  }
}

function makeFakeTaskStore(tasks: Task[] = []): FakeTaskStore {
  const map = new Map(tasks.map(t => [t.id, t]))
  return {
    tasks: map,
    async get(id) { return map.get(id) ?? undefined },
    async getAll() { return [...map.values()] },
    async save(t) { map.set(t.id, { ...t, updatedAt: new Date().toISOString() }) },
    async delete(id) { map.delete(id) },
    async getByGoal(goalId) { return [...map.values()].filter(t => t.goalId === goalId) },
    async getByStatus(s) { return [...map.values()].filter(t => t.status === s) },
    async getByAssignee(agentId) { return [...map.values()].filter(t => t.assignee === agentId) },
  }
}

function makeFakeRunStore(runs: Run[] = []): FakeRunStore {
  const map = new Map(runs.map(r => [r.id, r]))
  return {
    runs: map,
    async get(id) { return map.get(id) ?? undefined },
    async getAll() { return [...map.values()] },
    async save(r) { map.set(r.id, r) },
    async delete(id) { map.delete(id) },
    async getByTask(taskId) { return [...map.values()].filter(r => r.taskId === taskId) },
    async getByAgent(agentId) { return [...map.values()].filter(r => r.agentId === agentId) },
    async getActive() { return [...map.values()].filter(r => r.status === 'running' || r.status === 'preparing') },
  }
}

function makeFakeGoalStore() {
  return {
    goals: new Map<string, unknown>(),
    async get() { return undefined },
    async getAll() { return [] },
    async save() {},
    async delete() {},
  }
}

// ── Fake adapter ──────────────────────────────────────────────────────────────

function makeFakeAdapter(pid = 12345) {
  let stopped = false

  function generate() {
    const g: AsyncGenerator<{ type: 'done'; exitCode: number; tokenUsage?: { prompt: number; completion: number; total: number } }> = {
      async next() {
        return { done: true, value: { type: 'done' as const, exitCode: 0, tokenUsage: { prompt: 100, completion: 50, total: 150 } } }
      },
      async return(val?: unknown) { return { done: true, value: val } },
      async throw(e?: Error) { throw e },
      [Symbol.asyncIterator]() { return this },
    }
    return g
  }

  return {
    stopped,
    kind: 'fake',
    async test() { return { ok: true } },
    execute() { return { pid, output: generate() } },
    async stop(_pid: number) { stopped = true },
  }
}

function makeNeverCompleteAdapter(pid = 12345) {
  function generate() {
    const g: AsyncGenerator<{ type: string; chunk: string }> = {
      async next() {
        return { done: false, value: { type: 'output', chunk: 'working...' } }
      },
      async return(val?: unknown) { return { done: true, value: val } },
      async throw(e?: Error) { throw e },
      [Symbol.asyncIterator]() { return this },
    }
    return g
  }

  return {
    kind: 'fake-never',
    async test() { return { ok: true } },
    execute() { return { pid, output: generate() } },
    async stop() {},
  }
}

// ── Fake process manager ──────────────────────────────────────────────────────

function makeFakeProcessManager(alivePids = new Set<number>([12345])) {
  return {
    alivePids,
    isAlive(pid: number) { return alivePids.has(pid) },
    async spawn() { return { pid: 12345 } },
    async kill(_pid: number) {},
  }
}

// ── Fake workspace manager ─────────────────────────────────────────────────────

function makeFakeWorkspaceManager() {
  return {
    async prepare() { return { path: '/tmp/ws', branch: 'main' } },
    async merge() { return { ok: true } },
    async cleanup() {},
  }
}

// ── Test harness ─────────────────────────────────────────────────────────────

interface Harness {
  orchestrator: Orchestrator
  eventBus: EventBus
  agentStore: FakeAgentStore
  taskStore: FakeTaskStore
  runStore: FakeRunStore
  fakeAdapter: ReturnType<typeof makeFakeAdapter>
  processManager: ReturnType<typeof makeFakeProcessManager>
}

function buildHarness(overrides: {
  agents?: Agent[]
  tasks?: Task[]
  runs?: Run[]
  pollIntervalMs?: number
  stallTimeoutMs?: number
  maxConcurrentRuns?: number
  maxRetryAttempts?: number
  alivePids?: Set<number>
  adapterType?: 'fast' | 'slow'
} = {}): Harness {
  const eventBus = new EventBus()
  const agentStore = makeFakeAgentStore(overrides.agents ?? [])
  const taskStore = makeFakeTaskStore(overrides.tasks ?? [])
  const runStore = makeFakeRunStore(overrides.runs ?? [])
  const goalStore = makeFakeGoalStore()

  const agentService = new AgentService(agentStore as IAgentStore, eventBus)
  const taskService = new TaskService(taskStore as ITaskStore, eventBus)
  const runService = new RunService(runStore as IRunStore, eventBus)
  const goalService = new GoalService(goalStore as IGoalStore, eventBus)

  const fakeAdapter = overrides.adapterType === 'slow' ? makeNeverCompleteAdapter() : makeFakeAdapter()
  const adapters = new Map([['fake', fakeAdapter as unknown as IAgentAdapter]])

  const processManager = makeFakeProcessManager(overrides.alivePids ?? new Set([12345]))
  const workspaceManager = makeFakeWorkspaceManager()

  const orchestrator = new Orchestrator(
    { agent: agentService, task: taskService, run: runService, goal: goalService },
    adapters,
    processManager as unknown as IProcessManager,
    workspaceManager as unknown as IWorkspaceManager,
    eventBus,
    {
      pollIntervalMs: overrides.pollIntervalMs ?? 50,
      stallTimeoutMs: overrides.stallTimeoutMs ?? 300000,
      maxConcurrentRuns: overrides.maxConcurrentRuns ?? 5,
      maxRetryAttempts: overrides.maxRetryAttempts ?? 3,
    },
  )

  return { orchestrator, eventBus, agentStore, taskStore, runStore, fakeAdapter, processManager }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

async function waitFor(ms: number) { await new Promise(r => setTimeout(r, ms)) }

describe('Orchestrator', () => {

  describe('start / stop lifecycle', () => {
    it('start begins tick loop, stop cleans up', async () => {
      const { orchestrator, eventBus } = buildHarness({ pollIntervalMs: 20 })
      const ticks: unknown[] = []
      const off = eventBus.on('orchestrator:tick' as any, (e: any) => ticks.push(e))

      await orchestrator.start()
      await waitFor(100)
      const before = ticks.length
      await orchestrator.stop()
      await waitFor(60)
      off()

      expect(before).toBeGreaterThan(0)
      const newTicks = ticks.slice(before)
      expect(newTicks.length).toBe(0)
    })

    it('stop waits for in-flight tick', async () => {
      const { orchestrator } = buildHarness({ pollIntervalMs: 100 })
      await orchestrator.start()
      await orchestrator.stop()
    })
  })

  describe('tick loop order', () => {
    it('reconcile→dispatch→collect fires in sequence', async () => {
      // Test that a single tick completes dispatch→collect by observing
      // that task:assigned and agent:completed both fire, and assigned comes before completed
      const agent = createAgent({ name: 'a1', adapter: 'fake', role: 'dev' })
      const task = createTask({ title: 'task1', scope: ['src/foo.ts'], maxAttempts: 1 })

      const { orchestrator, eventBus } = buildHarness({
        agents: [agent],
        tasks: [task],
        pollIntervalMs: 50,
      })

      const events: string[] = []
      eventBus.on('task:assigned' as any, () => events.push('assigned'))
      eventBus.on('agent:completed' as any, () => events.push('completed'))

      await orchestrator.start()
      await waitFor(150)
      await orchestrator.stop()

      // Both events should have fired, assigned before completed
      expect(events).toContain('assigned')
      expect(events).toContain('completed')
      expect(events.indexOf('assigned')).toBeLessThan(events.indexOf('completed'))
    })
  })

  describe('reconcile — stall detection', () => {
    it('emits orchestrator:stall_detected when run exceeds stallTimeoutMs', async () => {
      const agent = createAgent({ name: 'a1', adapter: 'fake', role: 'dev' })
      const task = createTask({ title: 'stall-task', scope: ['src/x.ts'], maxAttempts: 1 })

      const { orchestrator, eventBus } = buildHarness({
        agents: [agent],
        tasks: [task],
        alivePids: new Set([12345]),
        stallTimeoutMs: 40,
        pollIntervalMs: 20,
        adapterType: 'slow',
      })

      const stalls: unknown[] = []
      const off = eventBus.on('orchestrator:stall_detected' as any, (e: any) => stalls.push(e))

      await orchestrator.start()
      await waitFor(200)
      await orchestrator.stop()
      off()

      expect(stalls.length).toBeGreaterThan(0)
    })
  })

  describe('dispatch', () => {
    it('assigns pending tasks to idle agents', async () => {
      const agent = createAgent({ name: 'a1', adapter: 'fake', role: 'dev' })
      const task = createTask({ title: 'task1', scope: ['src/foo.ts'], maxAttempts: 1 })

      const { orchestrator, taskStore } = buildHarness({
        agents: [agent],
        tasks: [task],
        pollIntervalMs: 30,
      })

      await orchestrator.start()
      await waitFor(200)
      await orchestrator.stop()

      const updatedTask = await taskStore.get(task.id)
      // Task should complete full cycle: in_progress → review
      expect(updatedTask?.status).toBe('review')
      expect(updatedTask?.assignee).toBe(agent.id)
    })

    it('respects scope overlap — emits scope_overlap event', async () => {
      const agent = createAgent({ name: 'a1', adapter: 'fake', role: 'dev' })
      const task1 = createTask({ title: 'task1', scope: ['src/foo.ts'] })
      const task2 = createTask({ title: 'task2', scope: ['src/foo.ts'] })

      const { orchestrator, eventBus } = buildHarness({
        agents: [agent],
        tasks: [task1, task2],
        pollIntervalMs: 30,
      })

      const overlaps: unknown[] = []
      const off = eventBus.on('task:scope_overlap' as any, (e: any) => overlaps.push(e))

      await orchestrator.start()
      await waitFor(200)
      await orchestrator.stop()
      off()

      // Overlap event must have fired when second task tried to dispatch against first task's scope
      expect(overlaps.length).toBeGreaterThan(0)
    })

    it('respects maxConcurrentRuns', async () => {
      const agents = [
        createAgent({ name: 'a1', adapter: 'fake' }),
        createAgent({ name: 'a2', adapter: 'fake' }),
        createAgent({ name: 'a3', adapter: 'fake' }),
      ]
      const tasks = [
        createTask({ title: 't1', scope: ['f1'] }),
        createTask({ title: 't2', scope: ['f2'] }),
        createTask({ title: 't3', scope: ['f3'] }),
      ]

      const { orchestrator, taskStore } = buildHarness({
        agents,
        tasks,
        maxConcurrentRuns: 2,
        pollIntervalMs: 30,
      })

      await orchestrator.start()
      await waitFor(300)
      await orchestrator.stop()

      const inProgress = [...taskStore.tasks.values()].filter(t => t.status === 'in_progress')
      expect(inProgress.length).toBeLessThanOrEqual(2)
    })
  })

  describe('collect', () => {
    it('updates task status to review when runs complete', async () => {
      const agent = createAgent({ name: 'a1', adapter: 'fake' })
      const task = createTask({ title: 'task1', maxAttempts: 1 })

      const { orchestrator, taskStore } = buildHarness({
        agents: [agent],
        tasks: [task],
        pollIntervalMs: 30,
      })

      await orchestrator.start()
      await waitFor(200)
      await orchestrator.stop()

      const updatedTask = await taskStore.get(task.id)
      expect(updatedTask?.status).toBe('review')
    })

    it('cascade fail marks dependent tasks as failed', async () => {
      const task1 = createTask({ title: 'task1' })
      task1.status = 'failed'

      const task2 = createTask({ title: 'task2', dependsOn: [task1.id] })
      task2.status = 'in_progress' // valid transition target for cascade

      const { orchestrator, taskStore } = buildHarness({
        agents: [createAgent({ name: 'a1', adapter: 'fake' })],
        tasks: [task1, task2],
      })

      await orchestrator.cascadeFail(task1.id, 'task1 failed')

      const t2 = await taskStore.get(task2.id)
      expect(t2?.status).toBe('failed')
    })
  })

  describe('reconcile — dead run detection', () => {
    it('marks run as failed when PID is no longer alive', async () => {
      const agent = createAgent({ name: 'a1', adapter: 'fake', role: 'dev' })
      const task = createTask({ title: 'dead-task', scope: ['src/y.ts'], maxAttempts: 1 })

      const alivePids = new Set([12345])
      const { orchestrator, taskStore } = buildHarness({
        agents: [agent],
        tasks: [task],
        alivePids,
        stallTimeoutMs: 40,
        pollIntervalMs: 20,
        adapterType: 'slow',
      })

      await orchestrator.start()
      await waitFor(80)
      // Simulate PID death — clear the shared set so isAlive returns false
      alivePids.clear()
      await waitFor(200)
      await orchestrator.stop()

      const updatedTask = await taskStore.get(task.id)
      expect(updatedTask?.status).toBe('failed')
    })
  })
})