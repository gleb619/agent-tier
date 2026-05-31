type AgentStatus = 'idle' | 'running' | 'disabled' | 'error'

interface AgentConfig {
  model?: string
  maxTokens?: number
  temperature?: number
  [key: string]: unknown
}

interface AgentStats {
  tasksCompleted: number
  tasksFailed: number
  totalTokensUsed: number
  lastRunAt?: string
}

interface Agent {
  id: string
  name: string
  adapter: string
  status: AgentStatus
  config: AgentConfig
  stats: AgentStats
  autonomous: boolean
  skills?: string[]
  role?: string
  createdAt: string
  updatedAt: string
}

function createAgent(input: {
  name: string
  adapter: string
  config?: AgentConfig
  role?: string
}): Agent {
  const now = new Date().toISOString()
  return {
    id: crypto.randomUUID(),
    name: input.name,
    adapter: input.adapter,
    status: 'idle',
    config: input.config ?? {},
    stats: { tasksCompleted: 0, tasksFailed: 0, totalTokensUsed: 0 },
    autonomous: false,
    skills: [],
    role: input.role,
    createdAt: now,
    updatedAt: now,
  }
}

export type { Agent, AgentConfig, AgentStats, AgentStatus }
export { createAgent }
