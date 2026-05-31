import type { IEventBus } from '../event-bus'
import { createRun, transitionRun, type Run, type RunStatus, type TokenUsage } from '../../domain'
import type { IRunStore } from '../ports'

export class RunService {
  constructor(
    private readonly store: IRunStore,
    private readonly eventBus: IEventBus,
  ) {}

  async create(input: { taskId: string; agentId: string; attempt: number; prompt: string }): Promise<Run> {
    const run = createRun(input)
    await this.store.save(run)
    return run
  }

  async start(id: string, workspacePath: string): Promise<void> {
    const run = await this.store.get(id)
    if (!run) return

    const updated = transitionRun(run, 'running', {
      workspacePath,
      startedAt: new Date().toISOString(),
    })
    await this.store.save(updated)
  }

  async complete(
    id: string,
    result: { status: 'succeeded' | 'failed' | 'timed_out'; tokenUsage?: TokenUsage },
  ): Promise<void> {
    const run = await this.store.get(id)
    if (!run) return

    const updated = transitionRun(run, result.status, {
      tokenUsage: result.tokenUsage,
      finishedAt: new Date().toISOString(),
    })
    await this.store.save(updated)
  }

  async getActive(): Promise<Run[]> {
    return this.store.getActive()
  }

  async getByTask(taskId: string): Promise<Run[]> {
    return this.store.getByTask(taskId)
  }
}