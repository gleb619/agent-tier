import { Run, RunStatus } from '../../domain'
import { IRunStore } from '../../application/ports'
import { FsStore } from './fs-store'

const ACTIVE_STATUSES: RunStatus[] = ['preparing', 'running']

export class RunStore extends FsStore<Run> implements IRunStore {
  constructor(storageDir?: string) {
    super('runs', storageDir)
  }

  async getByTask(taskId: string): Promise<Run[]> {
    const all = await this.getAll()
    return all.filter((r) => r.taskId === taskId)
  }

  async getByAgent(agentId: string): Promise<Run[]> {
    const all = await this.getAll()
    return all.filter((r) => r.agentId === agentId)
  }

  async getActive(): Promise<Run[]> {
    const all = await this.getAll()
    return all.filter((r) => ACTIVE_STATUSES.includes(r.status))
  }
}
