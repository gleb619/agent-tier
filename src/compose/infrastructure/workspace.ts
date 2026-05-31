import type { IWorkspaceManager, WorkspaceInfo, MergeResult } from '../application/ports.js'
import type { Task, Agent } from '../domain/index.js'

class InPlaceWorkspaceManager implements IWorkspaceManager {
  constructor(private readonly cwd: string = process.cwd()) {}

  async prepare(task: Task, agent: Agent): Promise<WorkspaceInfo> {
    return { path: this.cwd, branch: 'main' }
  }

  async merge(task: Task, branch: string, strategy?: 'merge' | 'squash'): Promise<MergeResult> {
    return { ok: true }
  }

  async cleanup(workspacePath: string): Promise<void> {
    // No-op for MVP
  }
}

function createWorkspaceManager(cwd?: string): InPlaceWorkspaceManager {
  return new InPlaceWorkspaceManager(cwd)
}

export { InPlaceWorkspaceManager, createWorkspaceManager }
