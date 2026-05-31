import type {
  Agent,
  Task,
  Run,
  Goal,
  Team,
  Message,
  AgentStatus,
  TaskStatus,
  TokenUsage,
} from '../domain'

// ---------------------------------------------------------------------------
// Store interfaces (CRUD pattern)
// ---------------------------------------------------------------------------

interface IStore<T> {
  get(id: string): Promise<T | undefined>
  getAll(): Promise<T[]>
  save(entity: T): Promise<void>
  delete(id: string): Promise<void>
}

interface IAgentStore extends IStore<Agent> {
  getByStatus(status: AgentStatus): Promise<Agent[]>
}

interface ITaskStore extends IStore<Task> {
  getByGoal(goalId: string): Promise<Task[]>
  getByStatus(status: TaskStatus): Promise<Task[]>
  getByAssignee(agentId: string): Promise<Task[]>
}

interface IRunStore extends IStore<Run> {
  getByTask(taskId: string): Promise<Run[]>
  getByAgent(agentId: string): Promise<Run[]>
  getActive(): Promise<Run[]>
}

interface IGoalStore extends IStore<Goal> {}

interface ITeamStore extends IStore<Team> {
  getByGoal(goalId: string): Promise<Team[]>
}

interface IMessageStore extends IStore<Message> {
  getByAgent(agentId: string): Promise<Message[]>
  getUnread(agentId: string): Promise<Message[]>
}

// ---------------------------------------------------------------------------
// Adapter interface
// ---------------------------------------------------------------------------

interface AdapterTestResult {
  ok: boolean
  error?: string
  latencyMs?: number
}

interface ExecuteParams {
  prompt: string
  cwd: string
  env?: Record<string, string>
  systemPrompt?: string
  maxTokens?: number
}

type AdapterAgentEvent =
  | { type: 'output'; chunk: string }
  | { type: 'file_change'; path: string; change: 'added' | 'modified' | 'deleted' }
  | { type: 'command'; command: string }
  | { type: 'tool_call'; tool: string; args: unknown }
  | { type: 'error'; message: string }
  | { type: 'done'; exitCode: number; tokenUsage?: TokenUsage }

interface IAgentAdapter {
  readonly kind: string
  test(): Promise<AdapterTestResult>
  execute(params: ExecuteParams): { pid: number; output: AsyncGenerator<AdapterAgentEvent> }
  stop(pid: number): Promise<void>
}

// ---------------------------------------------------------------------------
// Workspace interface
// ---------------------------------------------------------------------------

interface WorkspaceInfo {
  path: string
  branch: string
}

interface MergeResult {
  ok: boolean
  conflicts?: string[]
}

interface IWorkspaceManager {
  prepare(task: Task, agent: Agent): Promise<WorkspaceInfo>
  merge(task: Task, branch: string, strategy?: 'merge' | 'squash'): Promise<MergeResult>
  cleanup(workspacePath: string): Promise<void>
}

// ---------------------------------------------------------------------------
// Process interface
// ---------------------------------------------------------------------------

interface IProcessManager {
  spawn(
    command: string,
    args: string[],
    options: { cwd: string; env?: Record<string, string> },
  ): { pid: number }
  kill(pid: number): Promise<void> // SIGTERM → wait 5s → SIGKILL
  isAlive(pid: number): boolean
}

export type {
  IStore,
  IAgentStore,
  ITaskStore,
  IRunStore,
  IGoalStore,
  ITeamStore,
  IMessageStore,
  AdapterTestResult,
  ExecuteParams,
  AdapterAgentEvent,
  IAgentAdapter,
  WorkspaceInfo,
  MergeResult,
  IWorkspaceManager,
  IProcessManager,
}

export type { IEventBus, EventHandler } from './event-bus.js'
