import type { IEventBus } from '../event-bus'
import { createMessage, type Message } from '../../domain'
import type { IMessageStore } from '../ports'

export class MessageService {
  constructor(
    private readonly store: IMessageStore,
    private readonly eventBus: IEventBus,
  ) {}

  async send(input: { from: string; to: string; content: string; taskId?: string }): Promise<Message> {
    throw new Error('not implemented')
  }

  async markRead(id: string): Promise<void> {
    throw new Error('not implemented')
  }

  async getUnreadForAgent(agentId: string): Promise<Message[]> {
    throw new Error('not implemented')
  }
}