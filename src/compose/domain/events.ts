import type { TaskPriority, TaskStatus } from './task'
import type { RunStatus } from './run'
import type { GoalStatus } from './goal'

// ── Task events (7) ──

interface TaskCreatedEvent {
  id: string
  type: 'task:created'
  timestamp: string
  payload: { taskId: string; title: string; priority: TaskPriority }
}

interface TaskAssignedEvent {
  id: string
  type: 'task:assigned'
  timestamp: string
  payload: { taskId: string; agentId: string }
}

interface TaskStatusChangedEvent {
  id: string
  type: 'task:status_changed'
  timestamp: string
  payload: { taskId: string; from: TaskStatus; to: TaskStatus }
}

interface TaskAutoReviewedEvent {
  id: string
  type: 'task:auto_reviewed'
  timestamp: string
  payload: { taskId: string; result: 'approved' | 'rejected'; reason?: string }
}

interface TaskScopeOverlapEvent {
  id: string
  type: 'task:scope_overlap'
  timestamp: string
  payload: { taskId: string; overlappingTaskId: string; sharedFiles: string[] }
}

interface TaskCascadeFailedEvent {
  id: string
  type: 'task:cascade_failed'
  timestamp: string
  payload: { taskId: string; causedByTaskId: string; reason: string }
}

interface TaskOrphanedEvent {
  id: string
  type: 'task:orphaned'
  timestamp: string
  payload: { taskId: string; reason: string }
}

// ── Agent events (6) ──

interface AgentStartedEvent {
  id: string
  type: 'agent:started'
  timestamp: string
  payload: { agentId: string; taskId: string; runId: string }
}

interface AgentOutputEvent {
  id: string
  type: 'agent:output'
  timestamp: string
  payload: { agentId: string; runId: string; content: string }
}

interface AgentFileChangedEvent {
  id: string
  type: 'agent:file_changed'
  timestamp: string
  payload: { agentId: string; runId: string; path: string; changeType: 'created' | 'modified' | 'deleted' }
}

interface AgentCompletedEvent {
  id: string
  type: 'agent:completed'
  timestamp: string
  payload: { agentId: string; runId: string; taskId: string; status: RunStatus }
}

interface AgentErrorEvent {
  id: string
  type: 'agent:error'
  timestamp: string
  payload: { agentId: string; runId?: string; error: string }
}

interface AgentAutonomousToggledEvent {
  id: string
  type: 'agent:autonomous_toggled'
  timestamp: string
  payload: { agentId: string; autonomous: boolean }
}

// ── Run events (1) ──

interface RunRetryEvent {
  id: string
  type: 'run:retry'
  timestamp: string
  payload: { runId: string; taskId: string; agentId: string; attempt: number; delayMs: number }
}

// ── Orchestrator events (4) ──

interface OrchestratorTickEvent {
  id: string
  type: 'orchestrator:tick'
  timestamp: string
  payload: { tickNumber: number; activeTasks: number; idleAgents: number }
}

interface OrchestratorStallDetectedEvent {
  id: string
  type: 'orchestrator:stall_detected'
  timestamp: string
  payload: { reason: string; stuckTaskIds: string[] }
}

interface OrchestratorErrorEvent {
  id: string
  type: 'orchestrator:error'
  timestamp: string
  payload: { error: string; fatal: boolean }
}

interface OrchestratorShutdownEvent {
  id: string
  type: 'orchestrator:shutdown'
  timestamp: string
  payload: { reason: string; pendingTasks: number }
}

// ── Workspace events (2) ──

interface WorkspaceMergeSucceededEvent {
  id: string
  type: 'workspace:merge_succeeded'
  timestamp: string
  payload: { taskId: string; agentId: string; files: string[] }
}

interface WorkspaceMergeConflictEvent {
  id: string
  type: 'workspace:merge_conflict'
  timestamp: string
  payload: { taskId: string; agentId: string; conflictingFiles: string[] }
}

// ── Messaging events (2) ──

interface MessageSentEvent {
  id: string
  type: 'message:sent'
  timestamp: string
  payload: { messageId: string; fromAgentId: string; toAgentId: string }
}

interface MessageDeliveredEvent {
  id: string
  type: 'message:delivered'
  timestamp: string
  payload: { messageId: string; toAgentId: string }
}

// ── Team events (6) ──

interface TeamCreatedEvent {
  id: string
  type: 'team:created'
  timestamp: string
  payload: { teamId: string; name: string; memberIds: string[] }
}

interface TeamMemberJoinedEvent {
  id: string
  type: 'team:member_joined'
  timestamp: string
  payload: { teamId: string; agentId: string }
}

interface TeamMemberLeftEvent {
  id: string
  type: 'team:member_left'
  timestamp: string
  payload: { teamId: string; agentId: string }
}

interface TeamTaskClaimedEvent {
  id: string
  type: 'team:task_claimed'
  timestamp: string
  payload: { teamId: string; taskId: string; agentId: string }
}

interface TeamDisbandedEvent {
  id: string
  type: 'team:disbanded'
  timestamp: string
  payload: { teamId: string; reason?: string }
}

interface TeamTaskAddedEvent {
  id: string
  type: 'team:task_added'
  timestamp: string
  payload: { teamId: string; taskId: string }
}

// ── Goal events (4) ──

interface GoalCreatedEvent {
  id: string
  type: 'goal:created'
  timestamp: string
  payload: { goalId: string; title: string }
}

interface GoalStatusChangedEvent {
  id: string
  type: 'goal:status_changed'
  timestamp: string
  payload: { goalId: string; from: GoalStatus; to: GoalStatus }
}

interface GoalUpdatedEvent {
  id: string
  type: 'goal:updated'
  timestamp: string
  payload: { goalId: string; changes: Record<string, unknown> }
}

interface GoalDeletedEvent {
  id: string
  type: 'goal:deleted'
  timestamp: string
  payload: { goalId: string }
}

interface GoalCompleteEvent {
  id: string
  type: 'goal:complete'
  timestamp: string
  payload: { goalId: string }
}

// ── Discriminated unions ──

type DomainEvent =
  | TaskCreatedEvent | TaskAssignedEvent | TaskStatusChangedEvent | TaskAutoReviewedEvent
  | TaskScopeOverlapEvent | TaskCascadeFailedEvent | TaskOrphanedEvent
  | AgentStartedEvent | AgentOutputEvent | AgentFileChangedEvent | AgentCompletedEvent
  | AgentErrorEvent | AgentAutonomousToggledEvent
  | RunRetryEvent
  | OrchestratorTickEvent | OrchestratorStallDetectedEvent | OrchestratorErrorEvent | OrchestratorShutdownEvent
  | WorkspaceMergeSucceededEvent | WorkspaceMergeConflictEvent
  | MessageSentEvent | MessageDeliveredEvent
  | TeamCreatedEvent | TeamMemberJoinedEvent | TeamMemberLeftEvent | TeamTaskClaimedEvent
  | TeamDisbandedEvent | TeamTaskAddedEvent
  | GoalCreatedEvent | GoalStatusChangedEvent | GoalUpdatedEvent | GoalDeletedEvent | GoalCompleteEvent

type TaskEvent = Extract<DomainEvent, { type: `task:${string}` }>
type AgentEvent = Extract<DomainEvent, { type: `agent:${string}` }>
type RunEvent = Extract<DomainEvent, { type: `run:${string}` }>
type OrchestratorEvent = Extract<DomainEvent, { type: `orchestrator:${string}` }>
type WorkspaceEvent = Extract<DomainEvent, { type: `workspace:${string}` }>
type MessageEvent = Extract<DomainEvent, { type: `message:${string}` }>
type TeamEvent = Extract<DomainEvent, { type: `team:${string}` }>
type GoalEvent = Extract<DomainEvent, { type: `goal:${string}` }>

// ── Type guards ──

function isTaskEvent(e: DomainEvent): e is TaskEvent {
  return e.type.startsWith('task:')
}

function isAgentEvent(e: DomainEvent): e is AgentEvent {
  return e.type.startsWith('agent:')
}

function isRunEvent(e: DomainEvent): e is RunEvent {
  return e.type.startsWith('run:')
}

function isOrchestratorEvent(e: DomainEvent): e is OrchestratorEvent {
  return e.type.startsWith('orchestrator:')
}

function isWorkspaceEvent(e: DomainEvent): e is WorkspaceEvent {
  return e.type.startsWith('workspace:')
}

function isMessageEvent(e: DomainEvent): e is MessageEvent {
  return e.type.startsWith('message:')
}

function isTeamEvent(e: DomainEvent): e is TeamEvent {
  return e.type.startsWith('team:')
}

function isGoalEvent(e: DomainEvent): e is GoalEvent {
  return e.type.startsWith('goal:')
}

// ── Factory helpers ──

function taskEvent<T extends TaskEvent['type']>(
  type: T,
  payload: Extract<TaskEvent, { type: T }>['payload'],
): Extract<TaskEvent, { type: T }> {
  return {
    id: crypto.randomUUID(),
    type,
    timestamp: new Date().toISOString(),
    payload,
  } as Extract<TaskEvent, { type: T }>
}

function agentEvent<T extends AgentEvent['type']>(
  type: T,
  payload: Extract<AgentEvent, { type: T }>['payload'],
): Extract<AgentEvent, { type: T }> {
  return {
    id: crypto.randomUUID(),
    type,
    timestamp: new Date().toISOString(),
    payload,
  } as Extract<AgentEvent, { type: T }>
}

function runEvent<T extends RunEvent['type']>(
  type: T,
  payload: Extract<RunEvent, { type: T }>['payload'],
): Extract<RunEvent, { type: T }> {
  return {
    id: crypto.randomUUID(),
    type,
    timestamp: new Date().toISOString(),
    payload,
  } as Extract<RunEvent, { type: T }>
}

function orchestratorEvent<T extends OrchestratorEvent['type']>(
  type: T,
  payload: Extract<OrchestratorEvent, { type: T }>['payload'],
): Extract<OrchestratorEvent, { type: T }> {
  return {
    id: crypto.randomUUID(),
    type,
    timestamp: new Date().toISOString(),
    payload,
  } as Extract<OrchestratorEvent, { type: T }>
}

function workspaceEvent<T extends WorkspaceEvent['type']>(
  type: T,
  payload: Extract<WorkspaceEvent, { type: T }>['payload'],
): Extract<WorkspaceEvent, { type: T }> {
  return {
    id: crypto.randomUUID(),
    type,
    timestamp: new Date().toISOString(),
    payload,
  } as Extract<WorkspaceEvent, { type: T }>
}

function messageEvent<T extends MessageEvent['type']>(
  type: T,
  payload: Extract<MessageEvent, { type: T }>['payload'],
): Extract<MessageEvent, { type: T }> {
  return {
    id: crypto.randomUUID(),
    type,
    timestamp: new Date().toISOString(),
    payload,
  } as Extract<MessageEvent, { type: T }>
}

function teamEvent<T extends TeamEvent['type']>(
  type: T,
  payload: Extract<TeamEvent, { type: T }>['payload'],
): Extract<TeamEvent, { type: T }> {
  return {
    id: crypto.randomUUID(),
    type,
    timestamp: new Date().toISOString(),
    payload,
  } as Extract<TeamEvent, { type: T }>
}

function goalEvent<T extends GoalEvent['type']>(
  type: T,
  payload: Extract<GoalEvent, { type: T }>['payload'],
): Extract<GoalEvent, { type: T }> {
  return {
    id: crypto.randomUUID(),
    type,
    timestamp: new Date().toISOString(),
    payload,
  } as Extract<GoalEvent, { type: T }>
}

export type {
  DomainEvent,
  TaskEvent, AgentEvent, RunEvent, OrchestratorEvent,
  WorkspaceEvent, MessageEvent, TeamEvent, GoalEvent,
  TaskCreatedEvent, TaskAssignedEvent, TaskStatusChangedEvent, TaskAutoReviewedEvent,
  TaskScopeOverlapEvent, TaskCascadeFailedEvent, TaskOrphanedEvent,
  AgentStartedEvent, AgentOutputEvent, AgentFileChangedEvent, AgentCompletedEvent,
  AgentErrorEvent, AgentAutonomousToggledEvent,
  RunRetryEvent,
  OrchestratorTickEvent, OrchestratorStallDetectedEvent, OrchestratorErrorEvent, OrchestratorShutdownEvent,
  WorkspaceMergeSucceededEvent, WorkspaceMergeConflictEvent,
  MessageSentEvent, MessageDeliveredEvent,
  TeamCreatedEvent, TeamMemberJoinedEvent, TeamMemberLeftEvent, TeamTaskClaimedEvent,
  TeamDisbandedEvent, TeamTaskAddedEvent,
  GoalCreatedEvent, GoalStatusChangedEvent, GoalUpdatedEvent, GoalDeletedEvent, GoalCompleteEvent,
}

export {
  isTaskEvent, isAgentEvent, isRunEvent, isOrchestratorEvent,
  isWorkspaceEvent, isMessageEvent, isTeamEvent, isGoalEvent,
  taskEvent, agentEvent, runEvent, orchestratorEvent,
  workspaceEvent, messageEvent, teamEvent, goalEvent,
}
