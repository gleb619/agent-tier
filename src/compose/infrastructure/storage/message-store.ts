import { Message } from '../../domain'
import { IMessageStore } from '../../application/ports'
import { FsStore } from './fs-store'

export class MessageStore extends FsStore<Message> implements IMessageStore {
  constructor(storageDir?: string) {
    super('messages', storageDir)
  }

  async getByAgent(agentId: string): Promise<Message[]> {
    const all = await this.getAll()
    return all.filter((m) => m.fromAgentId === agentId || m.toAgentId === agentId)
  }

  async getUnread(agentId: string): Promise<Message[]> {
    const all = await this.getAll()
    return all.filter((m) => m.toAgentId === agentId && m.read === false)
  }
}
