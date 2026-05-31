type RunStatus = 'preparing' | 'running' | 'succeeded' | 'failed' | 'timed_out' | 'cancelled'

interface TokenUsage {
  prompt: number
  completion: number
  total: number
}

interface Run {
  id: string
  taskId: string
  agentId: string
  attempt: number
  status: RunStatus
  workspacePath?: string
  prompt: string
  tokenUsage?: TokenUsage
  startedAt?: string
  finishedAt?: string
  createdAt: string
}

function createRun(input: {
  taskId: string
  agentId: string
  attempt: number
  prompt: string
}): Run {
  return {
    id: crypto.randomUUID(),
    taskId: input.taskId,
    agentId: input.agentId,
    attempt: input.attempt,
    status: 'preparing',
    prompt: input.prompt,
    createdAt: new Date().toISOString(),
  }
}

export type { Run, RunStatus, TokenUsage }
export { createRun }
