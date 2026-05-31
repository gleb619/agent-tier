import { describe, expect, it } from 'vitest'
import { createAgent, type Agent } from '../../../src/compose/domain/agent'
import { createTask, type Task } from '../../../src/compose/domain/task'
import { createRun, type Run } from '../../../src/compose/domain/run'
import { createGoal, type Goal } from '../../../src/compose/domain/goal'
import { createTeam, type Team } from '../../../src/compose/domain/team'
import { createMessage, type Message } from '../../../src/compose/domain/message'

function isUUID(id: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)
}

function isISOString(val: unknown): val is string {
  if (typeof val !== 'string') return false
  return !isNaN(Date.parse(val)) && val.endsWith('Z')
}

describe('Agent', () => {
  it('returns valid UUID id', () => {
    const agent = createAgent({ name: 'test', adapter: 'test' })
    expect(isUUID(agent.id)).toBe(true)
  })

  it('has all required fields', () => {
    const agent = createAgent({ name: 'test', adapter: 'test' })
    expect(agent.name).toBe('test')
    expect(agent.adapter).toBe('test')
    expect(agent.status).toBe('idle')
    expect(agent.config).toEqual({})
    expect(agent.stats.tasksCompleted).toBe(0)
    expect(agent.stats.tasksFailed).toBe(0)
    expect(agent.stats.totalTokensUsed).toBe(0)
    expect(agent.autonomous).toBe(false)
    expect(agent.skills).toEqual([])
    expect(isISOString(agent.createdAt)).toBe(true)
    expect(isISOString(agent.updatedAt)).toBe(true)
  })

  it('applies default values', () => {
    const agent = createAgent({ name: 'test', adapter: 'test' })
    expect(agent.status).toBe('idle')
    expect(agent.config).toEqual({})
    expect(agent.skills).toEqual([])
  })

  it('overrides defaults with input', () => {
    const agent = createAgent({
      name: 'test',
      adapter: 'test',
      config: { model: 'claude-3' },
      role: 'coder',
    })
    expect(agent.config).toEqual({ model: 'claude-3' })
    expect(agent.role).toBe('coder')
  })

  it('optional role not present when not provided', () => {
    const agent = createAgent({ name: 'test', adapter: 'test' })
    expect(agent.role).toBeUndefined()
  })
})

describe('Task', () => {
  it('returns valid UUID id', () => {
    const task = createTask({ title: 'test task' })
    expect(isUUID(task.id)).toBe(true)
  })

  it('has all required fields', () => {
    const task = createTask({ title: 'test task' })
    expect(task.title).toBe('test task')
    expect(task.status).toBe('todo')
    expect(task.priority).toBe('medium')
    expect(task.labels).toEqual([])
    expect(task.dependsOn).toEqual([])
    expect(task.scope).toEqual([])
    expect(task.attempts).toBe(0)
    expect(task.maxAttempts).toBe(3)
    expect(isISOString(task.createdAt)).toBe(true)
    expect(isISOString(task.updatedAt)).toBe(true)
  })

  it('applies default values', () => {
    const task = createTask({ title: 'test task' })
    expect(task.status).toBe('todo')
    expect(task.priority).toBe('medium')
    expect(task.labels).toEqual([])
    expect(task.maxAttempts).toBe(3)
  })

  it('overrides defaults with input', () => {
    const task = createTask({
      title: 'test task',
      description: 'do stuff',
      priority: 'critical',
      scope: ['src/'],
      dependsOn: ['uuid-1'],
      goalId: 'goal-uuid',
      maxAttempts: 5,
    })
    expect(task.description).toBe('do stuff')
    expect(task.priority).toBe('critical')
    expect(task.scope).toEqual(['src/'])
    expect(task.dependsOn).toEqual(['uuid-1'])
    expect(task.goalId).toBe('goal-uuid')
    expect(task.maxAttempts).toBe(5)
  })

  it('optional fields not present when not provided', () => {
    const task = createTask({ title: 'test task' })
    expect(task.description).toBeUndefined()
    expect(task.assignee).toBeUndefined()
    expect(task.goalId).toBeUndefined()
    expect(task.result).toBeUndefined()
  })
})

describe('Run', () => {
  it('returns valid UUID id', () => {
    const run = createRun({ taskId: 't1', agentId: 'a1', attempt: 1, prompt: 'do it' })
    expect(isUUID(run.id)).toBe(true)
  })

  it('has all required fields', () => {
    const run = createRun({ taskId: 't1', agentId: 'a1', attempt: 1, prompt: 'do it' })
    expect(run.taskId).toBe('t1')
    expect(run.agentId).toBe('a1')
    expect(run.attempt).toBe(1)
    expect(run.status).toBe('preparing')
    expect(run.prompt).toBe('do it')
    expect(isISOString(run.createdAt)).toBe(true)
  })

  it('applies default status', () => {
    const run = createRun({ taskId: 't1', agentId: 'a1', attempt: 1, prompt: 'do it' })
    expect(run.status).toBe('preparing')
  })

  it('optional fields not present when not provided', () => {
    const run = createRun({ taskId: 't1', agentId: 'a1', attempt: 1, prompt: 'do it' })
    expect(run.workspacePath).toBeUndefined()
    expect(run.tokenUsage).toBeUndefined()
    expect(run.startedAt).toBeUndefined()
    expect(run.finishedAt).toBeUndefined()
  })
})

describe('Goal', () => {
  it('returns valid UUID id', () => {
    const goal = createGoal({ title: 'test goal', prompt: 'do stuff' })
    expect(isUUID(goal.id)).toBe(true)
  })

  it('has all required fields', () => {
    const goal = createGoal({ title: 'test goal', prompt: 'do stuff' })
    expect(goal.title).toBe('test goal')
    expect(goal.prompt).toBe('do stuff')
    expect(goal.status).toBe('pending')
    expect(isISOString(goal.createdAt)).toBe(true)
    expect(isISOString(goal.updatedAt)).toBe(true)
  })

  it('applies default status', () => {
    const goal = createGoal({ title: 'test goal', prompt: 'do stuff' })
    expect(goal.status).toBe('pending')
  })

  it('overrides defaults with input', () => {
    const goal = createGoal({ title: 'test goal', prompt: 'do stuff', description: 'more info' })
    expect(goal.description).toBe('more info')
  })

  it('optional description not present when not provided', () => {
    const goal = createGoal({ title: 'test goal', prompt: 'do stuff' })
    expect(goal.description).toBeUndefined()
  })
})

describe('Team', () => {
  it('returns valid UUID id', () => {
    const team = createTeam({ name: 'test team', memberIds: ['a1'] })
    expect(isUUID(team.id)).toBe(true)
  })

  it('has all required fields', () => {
    const team = createTeam({ name: 'test team', memberIds: ['a1'] })
    expect(team.name).toBe('test team')
    expect(team.status).toBe('forming')
    expect(team.memberIds).toEqual(['a1'])
    expect(isISOString(team.createdAt)).toBe(true)
    expect(isISOString(team.updatedAt)).toBe(true)
  })

  it('applies default status', () => {
    const team = createTeam({ name: 'test team', memberIds: ['a1'] })
    expect(team.status).toBe('forming')
  })

  it('overrides defaults with input', () => {
    const team = createTeam({ name: 'test team', memberIds: ['a1'], leadId: 'a2', goalId: 'g1' })
    expect(team.leadId).toBe('a2')
    expect(team.goalId).toBe('g1')
  })

  it('optional fields not present when not provided', () => {
    const team = createTeam({ name: 'test team', memberIds: ['a1'] })
    expect(team.leadId).toBeUndefined()
    expect(team.goalId).toBeUndefined()
  })
})

describe('Message', () => {
  it('returns valid UUID id', () => {
    const msg = createMessage({ fromAgentId: 'a1', toAgentId: 'a2', content: 'hello' })
    expect(isUUID(msg.id)).toBe(true)
  })

  it('has all required fields', () => {
    const msg = createMessage({ fromAgentId: 'a1', toAgentId: 'a2', content: 'hello' })
    expect(msg.fromAgentId).toBe('a1')
    expect(msg.toAgentId).toBe('a2')
    expect(msg.content).toBe('hello')
    expect(msg.read).toBe(false)
    expect(isISOString(msg.createdAt)).toBe(true)
  })

  it('applies default read = false', () => {
    const msg = createMessage({ fromAgentId: 'a1', toAgentId: 'a2', content: 'hello' })
    expect(msg.read).toBe(false)
  })

  it('overrides defaults with input', () => {
    const msg = createMessage({ fromAgentId: 'a1', toAgentId: 'a2', content: 'hello', taskId: 't1' })
    expect(msg.taskId).toBe('t1')
  })

  it('optional taskId not present when not provided', () => {
    const msg = createMessage({ fromAgentId: 'a1', toAgentId: 'a2', content: 'hello' })
    expect(msg.taskId).toBeUndefined()
  })
})
