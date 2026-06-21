import type {
  IEventBus,
  IAgentAdapter,
  IProcessManager,
  IWorkspaceManager,
} from './ports'
import type { Agent, Task, Run, TokenUsage } from '../domain'
import type { TaskStatus, TaskPriority, TaskStage } from '../domain'
import type { AgentService } from './services/agent-service'
import type { TaskService } from './services/task-service'
import type { RunService } from './services/run-service'
import type { GoalService } from './services/goal-service'

// ── Config ────────────────────────────────────────────────────────────────────

interface OrchestratorConfig {
  pollIntervalMs: number
  maxConcurrentRuns: number
  stallTimeoutMs: number
  maxRetryAttempts: number
}

const DEFAULT_CONFIG: OrchestratorConfig = {
  pollIntervalMs: 2000,
  maxConcurrentRuns: 5,
  stallTimeoutMs: 300000,
  maxRetryAttempts: 3,
}

// ── Active run tracking ───────────────────────────────────────────────────────

interface ActiveRun {
  runId: string
  taskId: string
  agentId: string
  pid: number
  adapter: IAgentAdapter
  outputIterator: AsyncGenerator<{ type: string; [key: string]: unknown }>
  startedAt: number
}

// ── Orchestrator ──────────────────────────────────────────────────────────────

class Orchestrator {
  private running = false
  private config: OrchestratorConfig
  private intervalHandle: ReturnType<typeof setInterval> | null = null
  private tickCount = 0
  private activeRuns = new Map<number, ActiveRun>()
  private activeTaskScopes = new Map<string, Set<string>>() // taskId -> Set of file paths
  private tickPromise: Promise<void> | null = null

  constructor(
    private readonly services: {
      agent: AgentService
      task: TaskService
      run: RunService
      goal: GoalService
    },
    private readonly adapters: Map<string, IAgentAdapter>,
    private readonly processManager: IProcessManager,
    private readonly workspaceManager: IWorkspaceManager,
    private readonly eventBus: IEventBus,
    config?: Partial<OrchestratorConfig>,
  ) {
    this.config = { ...DEFAULT_CONFIG, ...config }
  }

  // ── Lifecycle ────────────────────────────────────────────────────────────────

  async start(): Promise<void> {
    if (this.running) return
    this.running = true

    this.intervalHandle = setInterval(async () => {
      if (!this.running) return
      await this.tick()
    }, this.config.pollIntervalMs)
  }

  async stop(): Promise<void> {
    if (!this.running) return
    this.running = false

    // Wait for in-flight tick to complete
    if (this.tickPromise) {
      await this.tickPromise
    }

    // Kill all active run PIDs
    const killPromises: Promise<void>[] = []
    for (const [pid, activeRun] of this.activeRuns) {
      killPromises.push(this.killRun(pid, activeRun))
    }
    await Promise.all(killPromises)

    this.activeRuns.clear()
    this.activeTaskScopes.clear()

    if (this.intervalHandle) {
      clearInterval(this.intervalHandle)
      this.intervalHandle = null
    }

    this.eventBus.emit({
      id: crypto.randomUUID(),
      type: 'orchestrator:shutdown',
      timestamp: new Date().toISOString(),
      payload: { reason: 'stopped', pendingTasks: 0 },
    })
  }

  private async killRun(pid: number, activeRun: ActiveRun): Promise<void> {
    try {
      await activeRun.adapter.stop(pid)
    } catch {
      // Adapter stop failed, try process manager
      try {
        this.processManager.kill(pid)
      } catch {
        // Ignore kill errors during shutdown
      }
    }
  }

  // ── Main tick loop ──────────────────────────────────────────────────────────

  private async tick(): Promise<void> {
    this.tickPromise = this.doTick()
    await this.tickPromise
    this.tickPromise = null
  }

  private async doTick(): Promise<void> {
    this.tickCount++

    try {
      await this.reconcile()
      await this.dispatch()
      await this.collect()
    } catch (err) {
      try {
        this.eventBus.emit({
          id: crypto.randomUUID(),
          type: 'orchestrator:error',
          timestamp: new Date().toISOString(),
          payload: {
            error: err instanceof Error ? err.message : String(err),
            fatal: false,
          },
        })
      } catch (emitErr) {
        console.error('[orchestrator] error event failed to emit:', emitErr)
      }
    }
  }

  // ── Reconcile ───────────────────────────────────────────────────────────────

  private async reconcile(): Promise<void> {
    const activeRuns = await this.services.run.getActive()
    const now = Date.now()
    const stalledTaskIds: string[] = []
    const deadTaskIds: string[] = []

    for (const run of activeRuns) {
      if (run.status !== 'running' || !run.startedAt) continue

      // Check if we have an active run tracked by PID
      let foundActive = false
      for (const [pid, activeRun] of this.activeRuns) {
        if (activeRun.runId === run.id) {
          foundActive = true

          // Check PID liveness
          if (!this.processManager.isAlive(pid)) {
            deadTaskIds.push(run.taskId)
            await this.handleDeadRun(run, activeRun)
          } else {
            // Check for stalls
            const elapsed = now - activeRun.startedAt
            if (elapsed > this.config.stallTimeoutMs) {
              stalledTaskIds.push(run.taskId)
              await this.handleStalledRun(run, activeRun)
            }
          }
          break
        }
      }

      // If run is running but not in activeRuns map, it's orphaned
      if (!foundActive) {
        deadTaskIds.push(run.taskId)
      }
    }

    // Emit tick event
    const idleAgents = (await this.services.agent.list()).filter(a => a.status === 'idle').length
    this.eventBus.emit({
      id: crypto.randomUUID(),
      type: 'orchestrator:tick',
      timestamp: new Date().toISOString(),
      payload: {
        tickNumber: this.tickCount,
        activeTasks: this.activeRuns.size,
        idleAgents,
      },
    })

    // Emit stall detection if any
    if (stalledTaskIds.length > 0) {
      this.eventBus.emit({
        id: crypto.randomUUID(),
        type: 'orchestrator:stall_detected',
        timestamp: new Date().toISOString(),
        payload: {
          reason: 'execution timeout exceeded',
          stuckTaskIds: stalledTaskIds,
        },
      })
    }
  }

  private async handleDeadRun(run: Run, activeRun: ActiveRun): Promise<void> {
    // Remove from active runs
    this.activeRuns.delete(activeRun.pid)
    this.activeTaskScopes.delete(run.taskId)

    // Complete the run as failed
    await this.services.run.complete(run.id, { status: 'failed' })

    // Transition task
    const task = await this.services.task.get(run.taskId)
    if (task) {
      await this.services.task.updateStatus(run.taskId, 'failed')
      await this.handleTaskFailure(task, 'process died unexpectedly')
    }
  }

  private async handleStalledRun(run: Run, activeRun: ActiveRun): Promise<void> {
    // Kill the stalled process
    await this.killRun(activeRun.pid, activeRun)

    // Remove from active runs
    this.activeRuns.delete(activeRun.pid)
    this.activeTaskScopes.delete(run.taskId)

    // Complete the run as timed_out
    await this.services.run.complete(run.id, { status: 'timed_out' })

    // Transition task
    const task = await this.services.task.get(run.taskId)
    if (task) {
      await this.services.task.updateStatus(run.taskId, 'failed')
      await this.handleTaskFailure(task, 'execution timed out')
    }
  }

  // ── Dispatch ────────────────────────────────────────────────────────────────

  private async dispatch(): Promise<void> {
    // Check if we can dispatch more
    const availableSlots = this.config.maxConcurrentRuns - this.activeRuns.size
    if (availableSlots <= 0) return

    // Get ready tasks sorted by priority
    const readyTasks = await this.services.task.getReadyTasks()
    const sorted = this.sortByPriority(readyTasks)

    let dispatched = 0
    for (const task of sorted) {
      if (dispatched >= availableSlots) break
      if (this.activeTaskScopes.has(task.id)) continue // already active

      // Find best agent
      const agent = await this.services.agent.findBestAgent(task)
      if (!agent) continue

      // Check scope overlap with active tasks
      if (this.hasScopeOverlap(task)) {
        this.eventBus.emit({
          id: crypto.randomUUID(),
          type: 'task:scope_overlap',
          timestamp: new Date().toISOString(),
          payload: {
            taskId: task.id,
            overlappingTaskId: this.findOverlappingTaskId(task),
            sharedFiles: this.getSharedFiles(task),
          },
        })
        continue
      }

      // Dispatch the task
      const dispatched_ = await this.tryDispatchTask(task, agent)
      if (dispatched_) dispatched++
    }
  }

  private sortByPriority(tasks: Task[]): Task[] {
    const priorityOrder: Record<TaskPriority, number> = {
      critical: 0,
      high: 1,
      medium: 2,
      low: 3,
    }
    return [...tasks].sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority])
  }

  private hasScopeOverlap(task: Task): boolean {
    const taskScope = new Set(task.scope)
    if (taskScope.size === 0) return false

    for (const [, activeScope] of this.activeTaskScopes) {
      for (const file of activeScope) {
        if (taskScope.has(file)) return true
      }
    }
    return false
  }

  private findOverlappingTaskId(task: Task): string {
    const taskScope = new Set(task.scope)
    for (const [activeTaskId, activeScope] of this.activeTaskScopes) {
      for (const file of activeScope) {
        if (taskScope.has(file)) return activeTaskId
      }
    }
    return ''
  }

  private getSharedFiles(task: Task): string[] {
    const taskScope = new Set(task.scope)
    const shared: string[] = []
    for (const [, activeScope] of this.activeTaskScopes) {
      for (const file of activeScope) {
        if (taskScope.has(file) && !shared.includes(file)) {
          shared.push(file)
        }
      }
    }
    return shared
  }

  private async tryDispatchTask(task: Task, agent: Agent): Promise<boolean> {
    try {
      // Get adapter for agent
      const adapter = this.adapters.get(agent.adapter)
      if (!adapter) {
        this.eventBus.emit({
          id: crypto.randomUUID(),
          type: 'agent:error',
          timestamp: new Date().toISOString(),
          payload: { agentId: agent.id, error: `Adapter not found: ${agent.adapter}` },
        })
        return false
      }

      // Prepare workspace
      const workspaceInfo = await this.workspaceManager.prepare(task, agent)

      // Build prompt (simple template for now)
      const prompt = this.buildPrompt(task, agent, workspaceInfo)

      // Create run
      const run = await this.services.run.create({
        taskId: task.id,
        agentId: agent.id,
        attempt: task.attempts + 1,
        prompt,
      })

      // Start run
      await this.services.run.start(run.id, workspaceInfo.path)

      // Execute via adapter
      const { pid, output } = adapter.execute({
        prompt,
        cwd: workspaceInfo.path,
        systemPrompt: agent.config.systemPrompt as string | undefined,
        maxTokens: agent.config.maxTokens as number | undefined,
      })

      // Track active run
      this.activeRuns.set(pid, {
        runId: run.id,
        taskId: task.id,
        agentId: agent.id,
        pid,
        adapter,
        outputIterator: output as AsyncGenerator<{ type: string; [key: string]: unknown }>,
        startedAt: Date.now(),
      })

      // Track task scope
      this.activeTaskScopes.set(task.id, new Set(task.scope))

      // Transition task to in_progress
      await this.services.task.updateStatus(task.id, 'in_progress')
      await this.services.task.assign(task.id, agent.id)

      // Emit events
      this.eventBus.emit({
        id: crypto.randomUUID(),
        type: 'task:assigned',
        timestamp: new Date().toISOString(),
        payload: { taskId: task.id, agentId: agent.id },
      })

      this.eventBus.emit({
        id: crypto.randomUUID(),
        type: 'agent:started',
        timestamp: new Date().toISOString(),
        payload: { agentId: agent.id, taskId: task.id, runId: run.id },
      })

      return true
    } catch (err) {
      this.eventBus.emit({
        id: crypto.randomUUID(),
        type: 'orchestrator:error',
        timestamp: new Date().toISOString(),
        payload: {
          error: err instanceof Error ? err.message : String(err),
          fatal: false,
        },
      })
      return false
    }
  }

  private buildPrompt(task: Task, agent: Agent, workspace: { path: string; branch: string }): string {
    const scope = task.scope.length > 0 ? `\nScope: ${task.scope.join(', ')}` : ''
    return `Task: ${task.title}${task.description ? `\n${task.description}` : ''}${scope}\nWorking directory: ${workspace.path}`
  }

  // ── Collect ─────────────────────────────────────────────────────────────────

  private async collect(): Promise<void> {
    const completedPids: number[] = []

    for (const [pid, activeRun] of this.activeRuns) {
      // Check if adapter output is done
      const done = await this.checkRunDone(activeRun)
      if (done) {
        completedPids.push(pid)
      }
    }

    for (const pid of completedPids) {
      const activeRun = this.activeRuns.get(pid)
      if (!activeRun) continue

      await this.processCompletedRun(activeRun)
      this.activeRuns.delete(pid)
      this.activeTaskScopes.delete(activeRun.taskId)
    }
  }

  private async checkRunDone(activeRun: ActiveRun): Promise<boolean> {
    try {
      const result = await activeRun.outputIterator.next()
      if (result.done) return true

      // Process output events
      const event = result.value as { type: string; [key: string]: unknown }
      if (event.type === 'done') return true

      return false
    } catch {
      return true // Error means done
    }
  }

  private async processCompletedRun(activeRun: ActiveRun): Promise<void> {
    const { runId, taskId, agentId, pid } = activeRun

    // Get run and task
    const runs = await this.services.run.getByTask(taskId)
    const run = runs.find(r => r.id === runId)
    if (!run) return

    // Consume output to get final result
    let exitCode = 0
    let tokenUsage: TokenUsage | undefined

    try {
      for await (const event of activeRun.outputIterator) {
        if (event.type === 'done') {
          exitCode = (event as { type: 'done'; exitCode: number }).exitCode
          tokenUsage = (event as { type: 'done'; tokenUsage?: TokenUsage }).tokenUsage
          break
        }
      }
    } catch {
      exitCode = 1
    }

    // Complete run
    const status = exitCode === 0 ? 'succeeded' : 'failed'
    await this.services.run.complete(runId, { status, tokenUsage })

    // Get task
    const task = await this.services.task.get(taskId)
    if (!task) return

    if (status === 'succeeded') {
      // Transition to review
      await this.services.task.updateStatus(taskId, 'review')

      // Update agent stats
      await this.services.agent.updateStats(
        agentId,
        'completed',
        tokenUsage?.total ?? 0,
      )

      // Advance pipeline (arch→dev→test→review→goal:complete)
      await this.advancePipeline(task, status)

      // Emit completion
      this.eventBus.emit({
        id: crypto.randomUUID(),
        type: 'agent:completed',
        timestamp: new Date().toISOString(),
        payload: { agentId, runId, taskId, status },
      })
    } else {
      // Handle failure
      await this.services.agent.updateStats(agentId, 'failed', tokenUsage?.total ?? 0)
      await this.handleTaskFailure(task, 'run failed')
    }
  }

  private async advancePipeline(task: Task, status: string): Promise<void> {
    if (status !== 'succeeded' || !task.goalId) return

    const stageMap: Partial<Record<TaskStage, TaskStage>> = {
      arch: 'dev',
      dev: 'test',
      test: 'review',
    }

    const nextStage = stageMap[task.stage]

    if (nextStage) {
      const goal = await this.services.goal.get(task.goalId)
      if (!goal) return

      await this.services.task.create({
        title: '[' + nextStage + '] ' + goal.prompt.slice(0, 60),
        description: this.stageDescription(nextStage, goal.prompt),
        stage: nextStage,
        goalId: task.goalId,
        priority: nextStage === 'dev' ? 'high' : 'medium',
        dependsOn: [task.id],
      })
    } else if (task.stage === 'review') {
      this.eventBus.emit({
        id: crypto.randomUUID(),
        type: 'goal:complete',
        timestamp: new Date().toISOString(),
        payload: { goalId: task.goalId },
      })
    }
  }

  private stageDescription(stage: TaskStage, prompt: string): string {
    switch (stage) {
      case 'dev':    return 'Implement the following based on the architectural plan:\n' + prompt
      case 'test':   return 'Write and run tests for the implementation:\n' + prompt
      case 'review': return 'Review the implementation and tests for correctness and quality:\n' + prompt
      default:       return prompt
    }
  }

  private async handleTaskFailure(task: Task, reason: string): Promise<void> {
    // Check if we should retry
    if (task.attempts < this.config.maxRetryAttempts && task.attempts < task.maxAttempts) {
      await this.services.task.retry(task.id)
    } else {
      // Cascade fail
      await this.cascadeFail(task.id, reason)
    }
  }

  // ── Cascade fail ─────────────────────────────────────────────────────────────

  async cascadeFail(taskId: string, reason: string): Promise<void> {
    // Find all tasks that depend on this task
    const allTasks = await this.services.task.getAll()
    const dependentTasks = allTasks.filter(t => t.dependsOn.includes(taskId))

    for (const depTask of dependentTasks) {
      // Only fail if not already terminal
      if (depTask.status === 'done' || depTask.status === 'cancelled' || depTask.status === 'failed') {
        continue
      }

      // Transition to failed
      await this.services.task.updateStatus(depTask.id, 'failed')

      // Emit cascade failed event
      this.eventBus.emit({
        id: crypto.randomUUID(),
        type: 'task:cascade_failed',
        timestamp: new Date().toISOString(),
        payload: {
          taskId: depTask.id,
          causedByTaskId: taskId,
          reason: `Dependency failed: ${reason}`,
        },
      })

      // Recursively cascade
      await this.cascadeFail(depTask.id, `Cascaded from ${taskId}: ${reason}`)
    }
  }
}

export { Orchestrator, type OrchestratorConfig }
