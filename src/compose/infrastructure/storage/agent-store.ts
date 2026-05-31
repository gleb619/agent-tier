import { Agent, AgentStatus } from '../../domain'
import { IAgentStore } from '../../application/ports'
import { FsStore } from './fs-store'

export class AgentStore extends FsStore<Agent> implements IAgentStore {
  constructor(storageDir?: string) {
    super('agents', storageDir)
  }

  async getByStatus(status: AgentStatus): Promise<Agent[]> {
    const all = await this.getAll()
    return all.filter((a) => a.status === status)
  }
}
