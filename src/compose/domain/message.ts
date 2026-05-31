interface Message {
  id: string
  fromAgentId: string
  toAgentId: string
  taskId?: string
  content: string
  createdAt: string
  read: boolean
}

function createMessage(input: {
  fromAgentId: string
  toAgentId: string
  content: string
  taskId?: string
}): Message {
  return {
    id: crypto.randomUUID(),
    fromAgentId: input.fromAgentId,
    toAgentId: input.toAgentId,
    taskId: input.taskId,
    content: input.content,
    createdAt: new Date().toISOString(),
    read: false,
  }
}

export type { Message }
export { createMessage }
