import { describe, it, expect, beforeEach, vi } from 'vitest'
import { EventBus } from '../../../src/compose/application/event-bus'
import { AgentService } from '../../../src/compose/application/services/agent-service'
import { TaskService } from '../../../src/compose/application/services/task-service'
import { RunService } from '../../../src/compose/application/services/run-service'
import { GoalService } from '../../../src/compose/application/services/goal-service'
import { TeamService } from '../../../src/compose/application/services/team-service'
import { MessageService } from '../../../src/compose/application/services/message-service'
import type { Agent, Task, Run, Goal, Team, Message } from '../../../src/compose/domain'
import type { IAgentStore, ITaskStore, IRunStore, IGoalStore, ITeamStore, IMessageStore } from '../../../src/compose/application/ports'

// ── Mock stores ───────────────────────────────────────────────────────────────

function createMockAgentStore(agents: Agent[] = []): IAgentStore {
  let store = [...agents]
  return {
    get: vi.fn(async (id) => store.find(a => a.id === id)),
    getAll: vi.fn(async () => [...store]),
    save: vi.fn(async (agent) => {
      const idx = store.findIndex(a => a.id === agent.id)
      if (idx >= 0) store[idx] = agent
      else store.push(agent)
    }),
    delete: vi.fn(async (id) => { store = store.filter(a => a.id !== id) }),
    getByStatus: vi.fn(async () => store),
  }
}

function createMockTaskStore(tasks: Task[] = []): ITaskStore {
  let store = [...tasks]
  return {
    get: vi.fn(async (id) => store.find(t => t.id === id)),
    getAll: vi.fn(async () => [...store]),
    save: vi.fn(async (task) => {
      const idx = store.findIndex(t => t.id === task.id)
      if (idx >= 0) store[idx] = task
      else store.push(task)
    }),
    delete: vi.fn(async (id) => { store = store.filter(t => t.id !== id) }),
    getByGoal: vi.fn(async (goalId) => store.filter(t => t.goalId === goalId)),
    getByStatus: vi.fn(async (status) => store.filter(t => t.status === status)),
    getByAssignee: vi.fn(async (agentId) => store.filter(t => t.assignee === agentId)),
  }
}

function createMockRunStore(runs: Run[] = []): IRunStore {
  let store = [...runs]
  return {
    get: vi.fn(async (id) => store.find(r => r.id === id)),
    getAll: vi.fn(async () => [...store]),
    save: vi.fn(async (run) => {
      const idx = store.findIndex(r => r.id === run.id)
      if (idx >= 0) store[idx] = run
      else store.push(run)
    }),
    delete: vi.fn(async (id) => { store = store.filter(r => r.id !== id) }),
    getByTask: vi.fn(async (taskId) => store.filter(r => r.taskId === taskId)),
    getByAgent: vi.fn(async (agentId) => store.filter(r => r.agentId === agentId)),
    getActive: vi.fn(async () => store.filter(r => r.status === 'running')),
  }
}

function createMockGoalStore(goals: Goal[] = []): IGoalStore {
  let store = [...goals]
  return {
    get: vi.fn(async (id) => store.find(g => g.id === id)),
    getAll: vi.fn(async () => [...store]),
    save: vi.fn(async (goal) => {
      const idx = store.findIndex(g => g.id === goal.id)
      if (idx >= 0) store[idx] = goal
      else store.push(goal)
    }),
    delete: vi.fn(async (id) => { store = store.filter(g => g.id !== id) }),
  }
}

function createMockTeamStore(teams: Team[] = []): ITeamStore {
  let store = [...teams]
  return {
    get: vi.fn(async (id) => store.find(t => t.id === id)),
    getAll: vi.fn(async () => [...store]),
    save: vi.fn(async (team) => {
      const idx = store.findIndex(t => t.id === team.id)
      if (idx >= 0) store[idx] = team
      else store.push(team)
    }),
    delete: vi.fn(async (id) => { store = store.filter(t => t.id !== id) }),
    getByGoal: vi.fn(async () => []),
  }
}

function createMockMessageStore(messages: Message[] = []): IMessageStore {
  let store = [...messages]
  return {
    get: vi.fn(async (id) => store.find(m => m.id === id)),
    getAll: vi.fn(async () => [...store]),
    save: vi.fn(async (msg) => {
      const idx = store.findIndex(m => m.id === msg.id)
      if (idx >= 0) store[idx] = msg
      else store.push(msg)
    }),
    delete: vi.fn(async (id) => { store = store.filter(m => m.id !== id) }),
    getByAgent: vi.fn(async () => []),
    getUnread: vi.fn(async () => []),
  }
}

// ── AgentService tests ─────────────────────────────────────────────────────────

describe('AgentService', () => {
  let eventBus: EventBus
  let store: IAgentStore

  beforeEach(() => {
    eventBus = new EventBus()
    store = createMockAgentStore()
  })

  it('creates agent and saves to store', async () => {
    const service = new AgentService(store, eventBus)
    const agent = await service.create({ name: 'TestAgent', adapter: 'test', role: 'dev' })
    expect(agent.name).toBe('TestAgent')
    expect(store.save).toHaveBeenCalled()
  })

  it('findBestAgent prefers idle agents', async () => {
    const agentIdle: Agent = {
      id: 'a1', name: 'Idle', adapter: 'test', status: 'idle', config: {},
      stats: { tasksCompleted: 5, tasksFailed: 0, totalTokensUsed: 1000 },
      autonomous: false, createdAt: '', updatedAt: '',
    }
    const agentRunning: Agent = {
      id: 'a2', name: 'Running', adapter: 'test', status: 'running', config: {},
      stats: { tasksCompleted: 10, tasksFailed: 0, totalTokensUsed: 2000 },
      autonomous: false, createdAt: '', updatedAt: '',
    }
    store = createMockAgentStore([agentIdle, agentRunning])

    const service = new AgentService(store, eventBus)
    const task = { id: 't1', title: 'Test', status: 'todo' as const, priority: 'medium' as const,
      labels: [], dependsOn: [], scope: ['dev'], attempts: 0, maxAttempts: 3,
      createdAt: '', updatedAt: '' }

    const best = await service.findBestAgent(task)
    expect(best?.id).toBe('a1')
  })

  it('findBestAgent scores skill match', async () => {
    const agentDev: Agent = {
      id: 'a1', name: 'Dev', adapter: 'test', status: 'idle', config: {},
      stats: { tasksCompleted: 0, tasksFailed: 0, totalTokensUsed: 0 },
      autonomous: false, skills: ['typescript', 'react'], createdAt: '', updatedAt: '',
    }
    const agentNoSkill: Agent = {
      id: 'a2', name: 'NoSkill', adapter: 'test', status: 'idle', config: {},
      stats: { tasksCompleted: 0, tasksFailed: 0, totalTokensUsed: 0 },
      autonomous: false, skills: [], createdAt: '', updatedAt: '',
    }
    store = createMockAgentStore([agentDev, agentNoSkill])

    const service = new AgentService(store, eventBus)
    const task = { id: 't1', title: 'Test', status: 'todo' as const, priority: 'medium' as const,
      labels: [], dependsOn: [], scope: ['typescript'], attempts: 0, maxAttempts: 3,
      createdAt: '', updatedAt: '' }

    const best = await service.findBestAgent(task)
    expect(best?.id).toBe('a1')
  })

  it('updateStats increments token usage', async () => {
    const agent: Agent = {
      id: 'a1', name: 'Test', adapter: 'test', status: 'idle', config: {},
      stats: { tasksCompleted: 2, tasksFailed: 1, totalTokensUsed: 500 },
      autonomous: false, createdAt: '', updatedAt: '',
    }
    store = createMockAgentStore([agent])

    const service = new AgentService(store, eventBus)
    await service.updateStats('a1', 'completed', 100)

    const saved = (store.save as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(saved.stats.tasksCompleted).toBe(3)
    expect(saved.stats.totalTokensUsed).toBe(600)
  })

  it('setAutonomous emits event', async () => {
    const agent: Agent = {
      id: 'a1', name: 'Test', adapter: 'test', status: 'idle', config: {},
      stats: { tasksCompleted: 0, tasksFailed: 0, totalTokensUsed: 0 },
      autonomous: false, createdAt: '', updatedAt: '',
    }
    store = createMockAgentStore([agent])

    const service = new AgentService(store, eventBus)
    let received: any
    eventBus.on('agent:autonomous_toggled', (e: any) => { received = e })

    await service.setAutonomous('a1', true)
    expect(received.payload.agentId).toBe('a1')
    expect(received.payload.autonomous).toBe(true)
  })

  it('getById returns agent', async () => {
    const agent: Agent = {
      id: 'a1', name: 'Test', adapter: 'test', status: 'idle', config: {},
      stats: { tasksCompleted: 0, tasksFailed: 0, totalTokensUsed: 0 },
      autonomous: false, createdAt: '', updatedAt: '',
    }
    store = createMockAgentStore([agent])

    const service = new AgentService(store, eventBus)
    const result = await service.getById('a1')
    expect(result?.name).toBe('Test')
  })

  it('list returns all agents', async () => {
    store = createMockAgentStore([
      { id: 'a1', name: 'A1', adapter: 'test', status: 'idle', config: {},
        stats: { tasksCompleted: 0, tasksFailed: 0, totalTokensUsed: 0 },
        autonomous: false, createdAt: '', updatedAt: '' },
      { id: 'a2', name: 'A2', adapter: 'test', status: 'idle', config: {},
        stats: { tasksCompleted: 0, tasksFailed: 0, totalTokensUsed: 0 },
        autonomous: false, createdAt: '', updatedAt: '' },
    ])

    const service = new AgentService(store, eventBus)
    const agents = await service.list()
    expect(agents.length).toBe(2)
  })
})

// ── TaskService tests ──────────────────────────────────────────────────────────

describe('TaskService', () => {
  let eventBus: EventBus
  let store: ITaskStore

  beforeEach(() => {
    eventBus = new EventBus()
  })

  it('creates task and saves to store', async () => {
    store = createMockTaskStore()
    const service = new TaskService(store, eventBus)
    const task = await service.create({ title: 'Test Task' })
    expect(task.title).toBe('Test Task')
    expect(task.status).toBe('todo')
    expect(store.save).toHaveBeenCalled()
  })

  it('assign emits task:assigned event', async () => {
    const task: Task = {
      id: 't1', title: 'Test', status: 'todo', priority: 'medium',
      labels: [], dependsOn: [], scope: [], attempts: 0, maxAttempts: 3,
      createdAt: '', updatedAt: '',
    }
    store = createMockTaskStore([task])

    const service = new TaskService(store, eventBus)
    let received: any
    eventBus.on('task:assigned', (e: any) => { received = e })

    await service.assign('t1', 'a1')
    expect(received.payload.taskId).toBe('t1')
    expect(received.payload.agentId).toBe('a1')
  })

  it('updateStatus emits task:status_changed event', async () => {
    const task: Task = {
      id: 't1', title: 'Test', status: 'todo', priority: 'medium',
      labels: [], dependsOn: [], scope: [], attempts: 0, maxAttempts: 3,
      createdAt: '', updatedAt: '',
    }
    store = createMockTaskStore([task])

    const service = new TaskService(store, eventBus)
    let received: any
    eventBus.on('task:status_changed', (e: any) => { received = e })

    await service.updateStatus('t1', 'in_progress')
    expect(received.payload.taskId).toBe('t1')
    expect(received.payload.from).toBe('todo')
    expect(received.payload.to).toBe('in_progress')
  })

  it('updateStatus throws on invalid transition', async () => {
    const task: Task = {
      id: 't1', title: 'Test', status: 'done', priority: 'medium',
      labels: [], dependsOn: [], scope: [], attempts: 0, maxAttempts: 3,
      createdAt: '', updatedAt: '',
    }
    store = createMockTaskStore([task])

    const service = new TaskService(store, eventBus)
    await expect(service.updateStatus('t1', 'in_progress')).rejects.toThrow()
  })

  it('retry transitions to retrying then todo and emits run:retry', async () => {
    const task: Task = {
      id: 't1', title: 'Test', status: 'failed', priority: 'medium',
      labels: [], dependsOn: [], scope: [], attempts: 1, maxAttempts: 3,
      createdAt: '', updatedAt: '',
    }
    store = createMockTaskStore([task])

    const service = new TaskService(store, eventBus)
    let received: any
    eventBus.on('run:retry', (e: any) => { received = e })

    await service.retry('t1')
    expect(received.payload.taskId).toBe('t1')
    expect(received.payload.attempt).toBe(2)
  })

  it('getReadyTasks returns tasks with all deps satisfied', async () => {
    const tasks: Task[] = [
      { id: 't1', title: 'Dep1', status: 'in_progress', priority: 'medium',
        labels: [], dependsOn: [], scope: [], attempts: 0, maxAttempts: 3, createdAt: '', updatedAt: '' },
      { id: 't2', title: 'Dep2', status: 'done', priority: 'medium',
        labels: [], dependsOn: [], scope: [], attempts: 0, maxAttempts: 3, createdAt: '', updatedAt: '' },
      { id: 't3', title: 'Ready', status: 'todo', priority: 'medium',
        labels: [], dependsOn: ['t2'], scope: [], attempts: 0, maxAttempts: 3, createdAt: '', updatedAt: '' },
      { id: 't4', title: 'NotReady', status: 'todo', priority: 'medium',
        labels: [], dependsOn: ['t1'], scope: [], attempts: 0, maxAttempts: 3, createdAt: '', updatedAt: '' },
    ]
    store = createMockTaskStore(tasks)
    ;(store.getByStatus as ReturnType<typeof vi.fn>).mockResolvedValue(tasks.filter(t => t.status === 'todo'))

    const service = new TaskService(store, eventBus)
    const ready = await service.getReadyTasks()
    expect(ready.map(t => t.id)).toContain('t3')
    expect(ready.map(t => t.id)).not.toContain('t4')
  })

  it('cancel transitions to cancelled', async () => {
    const task: Task = {
      id: 't1', title: 'Test', status: 'todo', priority: 'medium',
      labels: [], dependsOn: [], scope: [], attempts: 0, maxAttempts: 3,
      createdAt: '', updatedAt: '',
    }
    store = createMockTaskStore([task])

    const service = new TaskService(store, eventBus)
    await service.cancel('t1')

    const saved = (store.save as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(saved.status).toBe('cancelled')
  })

  it('getByGoal returns tasks for goal', async () => {
    const tasks: Task[] = [
      { id: 't1', title: 'Task1', status: 'todo', priority: 'medium',
        labels: [], dependsOn: [], scope: [], attempts: 0, maxAttempts: 3, goalId: 'g1', createdAt: '', updatedAt: '' },
      { id: 't2', title: 'Task2', status: 'todo', priority: 'medium',
        labels: [], dependsOn: [], scope: [], attempts: 0, maxAttempts: 3, goalId: 'g2', createdAt: '', updatedAt: '' },
    ]
    store = createMockTaskStore(tasks)

    const service = new TaskService(store, eventBus)
    const result = await service.getByGoal('g1')
    expect(result.length).toBe(1)
    expect(result[0].id).toBe('t1')
  })
})

// ── RunService tests ───────────────────────────────────────────────────────────

describe('RunService', () => {
  let eventBus: EventBus
  let store: IRunStore

  beforeEach(() => {
    eventBus = new EventBus()
  })

  it('creates run and saves to store', async () => {
    store = createMockRunStore()
    const service = new RunService(store, eventBus)
    const run = await service.create({ taskId: 't1', agentId: 'a1', attempt: 1, prompt: 'test' })
    expect(run.taskId).toBe('t1')
    expect(run.status).toBe('preparing')
    expect(store.save).toHaveBeenCalled()
  })

  it('start transitions from preparing to running', async () => {
    const run: Run = {
      id: 'r1', taskId: 't1', agentId: 'a1', attempt: 1, status: 'preparing',
      prompt: 'test', createdAt: '',
    }
    store = createMockRunStore([run])

    const service = new RunService(store, eventBus)
    await service.start('r1', '/workspace/test')

    const saved = (store.save as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(saved.status).toBe('running')
    expect(saved.workspacePath).toBe('/workspace/test')
    expect(saved.startedAt).toBeDefined()
  })

  it('complete transitions to succeeded', async () => {
    const run: Run = {
      id: 'r1', taskId: 't1', agentId: 'a1', attempt: 1, status: 'running',
      prompt: 'test', startedAt: new Date().toISOString(), createdAt: '',
    }
    store = createMockRunStore([run])

    const service = new RunService(store, eventBus)
    await service.complete('r1', { status: 'succeeded', tokenUsage: { prompt: 100, completion: 50, total: 150 } })

    const saved = (store.save as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(saved.status).toBe('succeeded')
    expect(saved.tokenUsage?.total).toBe(150)
    expect(saved.finishedAt).toBeDefined()
  })

  it('complete transitions to failed', async () => {
    const run: Run = {
      id: 'r1', taskId: 't1', agentId: 'a1', attempt: 1, status: 'running',
      prompt: 'test', startedAt: new Date().toISOString(), createdAt: '',
    }
    store = createMockRunStore([run])

    const service = new RunService(store, eventBus)
    await service.complete('r1', { status: 'failed' })

    const saved = (store.save as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(saved.status).toBe('failed')
  })

  it('complete transitions to timed_out', async () => {
    const run: Run = {
      id: 'r1', taskId: 't1', agentId: 'a1', attempt: 1, status: 'running',
      prompt: 'test', startedAt: new Date().toISOString(), createdAt: '',
    }
    store = createMockRunStore([run])

    const service = new RunService(store, eventBus)
    await service.complete('r1', { status: 'timed_out' })

    const saved = (store.save as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(saved.status).toBe('timed_out')
  })

  it('getActive returns running runs', async () => {
    store = createMockRunStore([
      { id: 'r1', taskId: 't1', agentId: 'a1', attempt: 1, status: 'running', prompt: 'test', createdAt: '' },
      { id: 'r2', taskId: 't2', agentId: 'a1', attempt: 1, status: 'succeeded', prompt: 'test', createdAt: '' },
    ])

    const service = new RunService(store, eventBus)
    const active = await service.getActive()
    expect(active.length).toBe(1)
    expect(active[0].id).toBe('r1')
  })

  it('getByTask returns runs for task', async () => {
    store = createMockRunStore([
      { id: 'r1', taskId: 't1', agentId: 'a1', attempt: 1, status: 'succeeded', prompt: 'test', createdAt: '' },
      { id: 'r2', taskId: 't2', agentId: 'a1', attempt: 1, status: 'succeeded', prompt: 'test', createdAt: '' },
    ])

    const service = new RunService(store, eventBus)
    const runs = await service.getByTask('t1')
    expect(runs.length).toBe(1)
    expect(runs[0].id).toBe('r1')
  })
})

// ── GoalService tests ──────────────────────────────────────────────────────────

describe('GoalService', () => {
  let eventBus: EventBus
  let store: IGoalStore

  beforeEach(() => {
    eventBus = new EventBus()
  })

  it('creates goal with pending status', async () => {
    store = createMockGoalStore()
    const service = new GoalService(store, eventBus)
    const goal = await service.create({ title: 'Test Goal', prompt: 'Do something' })
    expect(goal.title).toBe('Test Goal')
    expect(goal.status).toBe('pending')
    expect(store.save).toHaveBeenCalled()
  })

  it('create emits goal:created event', async () => {
    store = createMockGoalStore()
    const service = new GoalService(store, eventBus)
    let received: any
    eventBus.on('goal:created', (e: any) => { received = e })

    const goal = await service.create({ title: 'Test', prompt: 'test' })
    expect(received.payload.goalId).toBe(goal.id)
    expect(received.payload.title).toBe('Test')
  })

  it('activate transitions from pending to active', async () => {
    const goal: Goal = {
      id: 'g1', title: 'Test', prompt: 'test', status: 'pending',
      createdAt: '', updatedAt: '',
    }
    store = createMockGoalStore([goal])

    const service = new GoalService(store, eventBus)
    await service.activate('g1')

    const saved = (store.save as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(saved.status).toBe('active')
  })

  it('activate emits goal:status_changed event', async () => {
    const goal: Goal = {
      id: 'g1', title: 'Test', prompt: 'test', status: 'pending',
      createdAt: '', updatedAt: '',
    }
    store = createMockGoalStore([goal])

    const service = new GoalService(store, eventBus)
    let received: any
    eventBus.on('goal:status_changed', (e: any) => { received = e })

    await service.activate('g1')
    expect(received.payload.goalId).toBe('g1')
    expect(received.payload.from).toBe('pending')
    expect(received.payload.to).toBe('active')
  })

  it('complete transitions from active to completed', async () => {
    const goal: Goal = {
      id: 'g1', title: 'Test', prompt: 'test', status: 'active',
      createdAt: '', updatedAt: '',
    }
    store = createMockGoalStore([goal])

    const service = new GoalService(store, eventBus)
    await service.complete('g1')

    const saved = (store.save as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(saved.status).toBe('completed')
  })

  it('complete throws if not in active status', async () => {
    const goal: Goal = {
      id: 'g1', title: 'Test', prompt: 'test', status: 'pending',
      createdAt: '', updatedAt: '',
    }
    store = createMockGoalStore([goal])

    const service = new GoalService(store, eventBus)
    await expect(service.complete('g1')).rejects.toThrow('Cannot complete goal')
  })

  it('abandon transitions from active to abandoned', async () => {
    const goal: Goal = {
      id: 'g1', title: 'Test', prompt: 'test', status: 'active',
      createdAt: '', updatedAt: '',
    }
    store = createMockGoalStore([goal])

    const service = new GoalService(store, eventBus)
    await service.abandon('g1')

    const saved = (store.save as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(saved.status).toBe('abandoned')
  })

  it('abandon throws if not in active status', async () => {
    const goal: Goal = {
      id: 'g1', title: 'Test', prompt: 'test', status: 'completed',
      createdAt: '', updatedAt: '',
    }
    store = createMockGoalStore([goal])

    const service = new GoalService(store, eventBus)
    await expect(service.abandon('g1')).rejects.toThrow('Cannot abandon goal')
  })
})

// ── TeamService stub tests ─────────────────────────────────────────────────────

describe('TeamService (MVP stub)', () => {
  let eventBus: EventBus
  let store: ITeamStore

  beforeEach(() => {
    eventBus = new EventBus()
    store = createMockTeamStore()
  })

  it('throws not implemented on create', async () => {
    const service = new TeamService(store, eventBus)
    await expect(service.create({ name: 'Test Team', memberIds: [] }))
      .rejects.toThrow('not implemented')
  })

  it('throws not implemented on addMember', async () => {
    const service = new TeamService(store, eventBus)
    await expect(service.addMember('t1', 'a1')).rejects.toThrow('not implemented')
  })

  it('throws not implemented on removeMember', async () => {
    const service = new TeamService(store, eventBus)
    await expect(service.removeMember('t1', 'a1')).rejects.toThrow('not implemented')
  })

  it('throws not implemented on claimTask', async () => {
    const service = new TeamService(store, eventBus)
    await expect(service.claimTask('t1', 'task1')).rejects.toThrow('not implemented')
  })

  it('throws not implemented on disband', async () => {
    const service = new TeamService(store, eventBus)
    await expect(service.disband('t1')).rejects.toThrow('not implemented')
  })
})

// ── MessageService stub tests ──────────────────────────────────────────────────

describe('MessageService (MVP stub)', () => {
  let eventBus: EventBus
  let store: IMessageStore

  beforeEach(() => {
    eventBus = new EventBus()
    store = createMockMessageStore()
  })

  it('throws not implemented on send', async () => {
    const service = new MessageService(store, eventBus)
    await expect(service.send({ from: 'a1', to: 'a2', content: 'hello' }))
      .rejects.toThrow('not implemented')
  })

  it('throws not implemented on markRead', async () => {
    const service = new MessageService(store, eventBus)
    await expect(service.markRead('m1')).rejects.toThrow('not implemented')
  })

  it('throws not implemented on getUnreadForAgent', async () => {
    const service = new MessageService(store, eventBus)
    await expect(service.getUnreadForAgent('a1')).rejects.toThrow('not implemented')
  })
})