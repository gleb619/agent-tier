import type { IEventBus } from '../event-bus'
import { createAgent, type Agent, type AgentConfig } from '../../domain'
import type { IAgentStore } from '../ports'
import type { Task } from '../../domain'

export class AgentService {
  constructor(
    private readonly store: IAgentStore,
    private readonly eventBus: IEventBus,
  ) {}

  async create(input: {
    name: string
    adapter: string
    config?: AgentConfig
    role?: string
  }): Promise<Agent> {
    const agent = createAgent(input)
    await this.store.save(agent)
    return agent
  }

  async findBestAgent(task: Task): Promise<Agent | undefined> {
    const agents = await this.store.getAll()
    const eligible = agents.filter(a => a.status !== 'disabled' && a.status !== 'error')

    if (eligible.length === 0) return undefined

    const scored = eligible.map(agent => ({
      agent,
      score: this.scoreAgent(agent, task),
    }))

    scored.sort((a, b) => b.score - a.score)
    return scored[0].agent
  }

  private scoreAgent(agent: Agent, task: Task): number {
    let score = 0

    // Skill/role match against task scope
    const taskScope = task.scope ?? []
    const agentSkills = agent.skills ?? []
    const agentRole = agent.role ?? ''

    if (agentRole && taskScope.some(s => agentRole.toLowerCase().includes(s.toLowerCase()))) {
      score += 30
    }

    const matchedSkills = taskScope.filter(s =>
      agentSkills.some(skill => skill.toLowerCase().includes(s.toLowerCase())),
    )
    score += matchedSkills.length * 20

    // Prefer idle over running
    if (agent.status === 'idle') {
      score += 25
    } else if (agent.status === 'running') {
      score += 5
    }

    // Factor in stats: success rate
    const total = agent.stats.tasksCompleted + agent.stats.tasksFailed
    if (total > 0) {
      const successRate = agent.stats.tasksCompleted / total
      score += successRate * 20
    }

    // Prefer agents that have handled similar scopes before
    if (agent.stats.tasksCompleted > 0) {
      score += Math.min(agent.stats.tasksCompleted * 2, 15)
    }

    return score
  }

  async updateStats(id: string, result: 'completed' | 'failed', tokens: number): Promise<void> {
    const agent = await this.store.get(id)
    if (!agent) return

    agent.stats.totalTokensUsed += tokens
    if (result === 'completed') {
      agent.stats.tasksCompleted++
    } else {
      agent.stats.tasksFailed++
    }
    agent.stats.lastRunAt = new Date().toISOString()

    await this.store.save(agent)
  }

  async setAutonomous(id: string, autonomous: boolean): Promise<void> {
    const agent = await this.store.get(id)
    if (!agent) return

    agent.autonomous = autonomous
    await this.store.save(agent)

    this.eventBus.emit({
      id: crypto.randomUUID(),
      type: 'agent:autonomous_toggled',
      timestamp: new Date().toISOString(),
      payload: { agentId: id, autonomous },
    })
  }

  async getById(id: string): Promise<Agent | undefined> {
    return this.store.get(id)
  }

  async list(): Promise<Agent[]> {
    return this.store.getAll()
  }
}