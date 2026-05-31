import { describe, it, expect } from 'vitest'
import {
  taskEvent,
  agentEvent,
  runEvent,
  orchestratorEvent,
  workspaceEvent,
  messageEvent,
  teamEvent,
  goalEvent,
  isTaskEvent,
  isAgentEvent,
  isRunEvent,
  isOrchestratorEvent,
  isWorkspaceEvent,
  isMessageEvent,
  isTeamEvent,
  isGoalEvent,
  type DomainEvent,
  type TaskEvent,
  type AgentEvent,
  type RunEvent,
  type OrchestratorEvent,
  type WorkspaceEvent,
  type MessageEvent,
  type TeamEvent,
  type GoalEvent,
} from '../../../src/compose/domain/events'

describe('event factories', () => {
  it('produces task:created', () => {
    const e = taskEvent('task:created', { taskId: 't1', title: 'Test', priority: 'high' })
    expect(e.type).toBe('task:created')
    expect(e.payload).toEqual({ taskId: 't1', title: 'Test', priority: 'high' })
    expect(typeof e.id).toBe('string')
    expect(typeof e.timestamp).toBe('string')
    const de: DomainEvent = e
    expect(de).toBe(e)
  })

  it('produces task:assigned', () => {
    const e = taskEvent('task:assigned', { taskId: 't1', agentId: 'a1' })
    expect(e.type).toBe('task:assigned')
    expect(e.payload).toEqual({ taskId: 't1', agentId: 'a1' })
  })

  it('produces task:status_changed', () => {
    const e = taskEvent('task:status_changed', { taskId: 't1', from: 'todo', to: 'in_progress' })
    expect(e.type).toBe('task:status_changed')
    expect(e.payload).toEqual({ taskId: 't1', from: 'todo', to: 'in_progress' })
  })

  it('produces task:auto_reviewed', () => {
    const e = taskEvent('task:auto_reviewed', { taskId: 't1', result: 'approved' })
    expect(e.type).toBe('task:auto_reviewed')
    expect(e.payload.result).toBe('approved')
  })

  it('produces task:scope_overlap', () => {
    const e = taskEvent('task:scope_overlap', { taskId: 't1', overlappingTaskId: 't2', sharedFiles: ['f1.ts'] })
    expect(e.type).toBe('task:scope_overlap')
    expect(e.payload.sharedFiles).toEqual(['f1.ts'])
  })

  it('produces task:cascade_failed', () => {
    const e = taskEvent('task:cascade_failed', { taskId: 't1', causedByTaskId: 't2', reason: 'dep failed' })
    expect(e.type).toBe('task:cascade_failed')
    expect(e.payload.reason).toBe('dep failed')
  })

  it('produces task:orphaned', () => {
    const e = taskEvent('task:orphaned', { taskId: 't1', reason: 'no agent' })
    expect(e.type).toBe('task:orphaned')
    expect(e.payload.reason).toBe('no agent')
  })

  it('produces agent:started', () => {
    const e = agentEvent('agent:started', { agentId: 'a1', taskId: 't1', runId: 'r1' })
    expect(e.type).toBe('agent:started')
    expect(e.payload).toEqual({ agentId: 'a1', taskId: 't1', runId: 'r1' })
    const de: DomainEvent = e
    expect(de).toBe(e)
  })

  it('produces agent:output', () => {
    const e = agentEvent('agent:output', { agentId: 'a1', runId: 'r1', content: 'hello' })
    expect(e.type).toBe('agent:output')
    expect(e.payload.content).toBe('hello')
  })

  it('produces agent:file_changed', () => {
    const e = agentEvent('agent:file_changed', { agentId: 'a1', runId: 'r1', path: 'x.ts', changeType: 'modified' })
    expect(e.type).toBe('agent:file_changed')
    expect(e.payload.changeType).toBe('modified')
  })

  it('produces agent:completed', () => {
    const e = agentEvent('agent:completed', { agentId: 'a1', runId: 'r1', taskId: 't1', status: 'succeeded' })
    expect(e.type).toBe('agent:completed')
    expect(e.payload.status).toBe('succeeded')
  })

  it('produces agent:error', () => {
    const e = agentEvent('agent:error', { agentId: 'a1', runId: 'r1', error: 'boom' })
    expect(e.type).toBe('agent:error')
    expect(e.payload.error).toBe('boom')
  })

  it('produces agent:autonomous_toggled', () => {
    const e = agentEvent('agent:autonomous_toggled', { agentId: 'a1', autonomous: true })
    expect(e.type).toBe('agent:autonomous_toggled')
    expect(e.payload.autonomous).toBe(true)
  })

  it('produces run:retry', () => {
    const e = runEvent('run:retry', { runId: 'r1', taskId: 't1', agentId: 'a1', attempt: 2, delayMs: 1000 })
    expect(e.type).toBe('run:retry')
    expect(e.payload).toEqual({ runId: 'r1', taskId: 't1', agentId: 'a1', attempt: 2, delayMs: 1000 })
    const de: DomainEvent = e
    expect(de).toBe(e)
  })

  it('produces orchestrator:tick', () => {
    const e = orchestratorEvent('orchestrator:tick', { tickNumber: 5, activeTasks: 2, idleAgents: 3 })
    expect(e.type).toBe('orchestrator:tick')
    expect(e.payload.tickNumber).toBe(5)
    const de: DomainEvent = e
    expect(de).toBe(e)
  })

  it('produces orchestrator:stall_detected', () => {
    const e = orchestratorEvent('orchestrator:stall_detected', { reason: 'stuck', stuckTaskIds: ['t1'] })
    expect(e.type).toBe('orchestrator:stall_detected')
    expect(e.payload.stuckTaskIds).toEqual(['t1'])
  })

  it('produces orchestrator:error', () => {
    const e = orchestratorEvent('orchestrator:error', { error: 'oops', fatal: false })
    expect(e.type).toBe('orchestrator:error')
    expect(e.payload.fatal).toBe(false)
  })

  it('produces orchestrator:shutdown', () => {
    const e = orchestratorEvent('orchestrator:shutdown', { reason: 'done', pendingTasks: 0 })
    expect(e.type).toBe('orchestrator:shutdown')
    expect(e.payload.pendingTasks).toBe(0)
  })

  it('produces workspace:merge_succeeded', () => {
    const e = workspaceEvent('workspace:merge_succeeded', { taskId: 't1', agentId: 'a1', files: ['x.ts'] })
    expect(e.type).toBe('workspace:merge_succeeded')
    expect(e.payload.files).toEqual(['x.ts'])
    const de: DomainEvent = e
    expect(de).toBe(e)
  })

  it('produces workspace:merge_conflict', () => {
    const e = workspaceEvent('workspace:merge_conflict', { taskId: 't1', agentId: 'a1', conflictingFiles: ['x.ts'] })
    expect(e.type).toBe('workspace:merge_conflict')
    expect(e.payload.conflictingFiles).toEqual(['x.ts'])
  })

  it('produces message:sent', () => {
    const e = messageEvent('message:sent', { messageId: 'm1', fromAgentId: 'a1', toAgentId: 'a2' })
    expect(e.type).toBe('message:sent')
    expect(e.payload.fromAgentId).toBe('a1')
    const de: DomainEvent = e
    expect(de).toBe(e)
  })

  it('produces message:delivered', () => {
    const e = messageEvent('message:delivered', { messageId: 'm1', toAgentId: 'a2' })
    expect(e.type).toBe('message:delivered')
    expect(e.payload.toAgentId).toBe('a2')
  })

  it('produces team:created', () => {
    const e = teamEvent('team:created', { teamId: 'tm1', name: 'Alpha', memberIds: ['a1'] })
    expect(e.type).toBe('team:created')
    expect(e.payload.name).toBe('Alpha')
    const de: DomainEvent = e
    expect(de).toBe(e)
  })

  it('produces team:member_joined', () => {
    const e = teamEvent('team:member_joined', { teamId: 'tm1', agentId: 'a1' })
    expect(e.type).toBe('team:member_joined')
    expect(e.payload.agentId).toBe('a1')
  })

  it('produces team:member_left', () => {
    const e = teamEvent('team:member_left', { teamId: 'tm1', agentId: 'a1' })
    expect(e.type).toBe('team:member_left')
  })

  it('produces team:task_claimed', () => {
    const e = teamEvent('team:task_claimed', { teamId: 'tm1', taskId: 't1', agentId: 'a1' })
    expect(e.type).toBe('team:task_claimed')
  })

  it('produces team:disbanded', () => {
    const e = teamEvent('team:disbanded', { teamId: 'tm1', reason: 'done' })
    expect(e.type).toBe('team:disbanded')
    expect(e.payload.reason).toBe('done')
  })

  it('produces team:task_added', () => {
    const e = teamEvent('team:task_added', { teamId: 'tm1', taskId: 't1' })
    expect(e.type).toBe('team:task_added')
  })

  it('produces goal:created', () => {
    const e = goalEvent('goal:created', { goalId: 'g1', title: 'Ship it' })
    expect(e.type).toBe('goal:created')
    expect(e.payload.title).toBe('Ship it')
    const de: DomainEvent = e
    expect(de).toBe(e)
  })

  it('produces goal:status_changed', () => {
    const e = goalEvent('goal:status_changed', { goalId: 'g1', from: 'pending', to: 'active' })
    expect(e.type).toBe('goal:status_changed')
    expect(e.payload.from).toBe('pending')
    expect(e.payload.to).toBe('active')
  })

  it('produces goal:updated', () => {
    const e = goalEvent('goal:updated', { goalId: 'g1', changes: { title: 'New' } })
    expect(e.type).toBe('goal:updated')
    expect(e.payload.changes).toEqual({ title: 'New' })
  })

  it('produces goal:deleted', () => {
    const e = goalEvent('goal:deleted', { goalId: 'g1' })
    expect(e.type).toBe('goal:deleted')
    expect(e.payload.goalId).toBe('g1')
  })
})

describe('type guards', () => {
  const te: TaskEvent = taskEvent('task:created', { taskId: 't1', title: 'T', priority: 'medium' })
  const ae: AgentEvent = agentEvent('agent:started', { agentId: 'a1', taskId: 't1', runId: 'r1' })
  const re: RunEvent = runEvent('run:retry', { runId: 'r1', taskId: 't1', agentId: 'a1', attempt: 1, delayMs: 0 })
  const oe: OrchestratorEvent = orchestratorEvent('orchestrator:tick', { tickNumber: 1, activeTasks: 0, idleAgents: 0 })
  const we: WorkspaceEvent = workspaceEvent('workspace:merge_succeeded', { taskId: 't1', agentId: 'a1', files: [] })
  const me: MessageEvent = messageEvent('message:sent', { messageId: 'm1', fromAgentId: 'a1', toAgentId: 'a2' })
  const tme: TeamEvent = teamEvent('team:created', { teamId: 'tm1', name: 'T', memberIds: [] })
  const ge: GoalEvent = goalEvent('goal:created', { goalId: 'g1', title: 'G' })

  const all = [te, ae, re, oe, we, me, tme, ge] as const

  it('isTaskEvent', () => {
    expect(isTaskEvent(te)).toBe(true)
    for (const e of all) if (e !== te) expect(isTaskEvent(e)).toBe(false)
  })

  it('isAgentEvent', () => {
    expect(isAgentEvent(ae)).toBe(true)
    for (const e of all) if (e !== ae) expect(isAgentEvent(e)).toBe(false)
  })

  it('isRunEvent', () => {
    expect(isRunEvent(re)).toBe(true)
    for (const e of all) if (e !== re) expect(isRunEvent(e)).toBe(false)
  })

  it('isOrchestratorEvent', () => {
    expect(isOrchestratorEvent(oe)).toBe(true)
    for (const e of all) if (e !== oe) expect(isOrchestratorEvent(e)).toBe(false)
  })

  it('isWorkspaceEvent', () => {
    expect(isWorkspaceEvent(we)).toBe(true)
    for (const e of all) if (e !== we) expect(isWorkspaceEvent(e)).toBe(false)
  })

  it('isMessageEvent', () => {
    expect(isMessageEvent(me)).toBe(true)
    for (const e of all) if (e !== me) expect(isMessageEvent(e)).toBe(false)
  })

  it('isTeamEvent', () => {
    expect(isTeamEvent(tme)).toBe(true)
    for (const e of all) if (e !== tme) expect(isTeamEvent(e)).toBe(false)
  })

  it('isGoalEvent', () => {
    expect(isGoalEvent(ge)).toBe(true)
    for (const e of all) if (e !== ge) expect(isGoalEvent(e)).toBe(false)
  })
})
