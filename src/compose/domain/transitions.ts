import { InvalidTransitionError } from './errors'
import type { Task, TaskStatus } from './task'
import type { Run, RunStatus } from './run'
import type { Agent, AgentStatus } from './agent'

// --- Task transitions ---

const TASK_TRANSITIONS: Record<TaskStatus, TaskStatus[]> = {
  todo: ['in_progress', 'cancelled'],
  in_progress: ['review', 'failed', 'cancelled'],
  review: ['done', 'failed', 'retrying'],
  retrying: ['todo'],
  failed: ['retrying'],
  done: [],
  cancelled: [],
}

function canTransitionTask(from: TaskStatus, to: TaskStatus): boolean {
  return TASK_TRANSITIONS[from]?.includes(to) ?? false
}

function transitionTask(task: Task, to: TaskStatus): Task {
  if (!canTransitionTask(task.status, to)) {
    throw new InvalidTransitionError(task.status, to, 'task')
  }

  // Guard: failed -> retrying only when attempts < maxAttempts
  if (task.status === 'failed' && to === 'retrying' && task.attempts >= task.maxAttempts) {
    throw new InvalidTransitionError(task.status, to, 'task')
  }

  const now = new Date().toISOString()
  const incremented = (to === 'retrying') ? { attempts: task.attempts + 1 } : {}

  return { ...task, ...incremented, status: to, updatedAt: now }
}

// --- Run transitions ---

const RUN_TRANSITIONS: Record<RunStatus, RunStatus[]> = {
  preparing: ['running', 'cancelled'],
  running: ['succeeded', 'failed', 'timed_out', 'cancelled'],
  succeeded: [],
  failed: [],
  timed_out: [],
  cancelled: [],
}

function canTransitionRun(from: RunStatus, to: RunStatus): boolean {
  return RUN_TRANSITIONS[from]?.includes(to) ?? false
}

function transitionRun(run: Run, to: RunStatus, extra?: Partial<Run>): Run {
  if (!canTransitionRun(run.status, to)) {
    throw new InvalidTransitionError(run.status, to, 'run')
  }

  return { ...run, ...extra, status: to }
}

// --- Agent transitions ---

const AGENT_TRANSITIONS: Record<AgentStatus, AgentStatus[]> = {
  idle: ['running', 'disabled'],
  running: ['idle', 'error'],
  error: ['idle', 'disabled'],
  disabled: ['idle'],
}

function canTransitionAgent(from: AgentStatus, to: AgentStatus): boolean {
  return AGENT_TRANSITIONS[from]?.includes(to) ?? false
}

function transitionAgent(agent: Agent, to: AgentStatus): Agent {
  if (!canTransitionAgent(agent.status, to)) {
    throw new InvalidTransitionError(agent.status, to, 'agent')
  }

  return { ...agent, status: to, updatedAt: new Date().toISOString() }
}

// --- Retry delay ---

function calculateRetryDelay(attempt: number, baseMs?: number, maxMs?: number): number {
  const base = baseMs ?? 1000
  const max = maxMs ?? 60000
  const exponential = base * Math.pow(2, attempt)
  const jitter = Math.floor(Math.random() * base)
  return Math.min(exponential + jitter, max)
}

export {
  canTransitionTask,
  transitionTask,
  canTransitionRun,
  transitionRun,
  canTransitionAgent,
  transitionAgent,
  calculateRetryDelay,
}
