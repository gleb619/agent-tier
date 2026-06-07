import { EventBus } from '../application/event-bus'
import { AgentService } from '../application/services/agent-service'
import { TaskService } from '../application/services/task-service'
import { RunService } from '../application/services/run-service'
import { GoalService } from '../application/services/goal-service'
import { TeamService } from '../application/services/team-service'
import { MessageService } from '../application/services/message-service'
import { Orchestrator } from '../application/orchestrator'
import { AgentStore } from '../infrastructure/storage/agent-store'
import { TaskStore } from '../infrastructure/storage/task-store'
import { RunStore } from '../infrastructure/storage/run-store'
import { GoalStore } from '../infrastructure/storage/goal-store'
import { TeamStore } from '../infrastructure/storage/team-store'
import { MessageStore } from '../infrastructure/storage/message-store'
import { AgentAdapter, createAdapterForAgent } from '../infrastructure/adapters/agent-adapter'
import { ProcessManager } from '../infrastructure/process'
import { InPlaceWorkspaceManager } from '../infrastructure/workspace'
import { loadConfig, type ComposeConfig } from '../infrastructure/config'
import { AGENTS } from '../../agents/registry'

// ── Interfaces ─────────────────────────────────────────────────────────────────

export interface LightContainer {
  eventBus: EventBus
  stores: {
    agent: AgentStore
    task: TaskStore
    run: RunStore
    goal: GoalStore
    team: TeamStore
    message: MessageStore
  }
  services: {
    agent: AgentService
    task: TaskService
    run: RunService
    goal: GoalService
    team: TeamService
    message: MessageService
  }
}

export interface FullContainer extends LightContainer {
  orchestrator: Orchestrator
  adapters: Map<string, AgentAdapter>
  processManager: ProcessManager
  workspaceManager: InPlaceWorkspaceManager
  config: ComposeConfig
}

// ── Builders ───────────────────────────────────────────────────────────────────

export function buildLightContainer(configPath?: string): LightContainer {
  const config = loadConfig(configPath)

  // Stores
  const agentStore = new AgentStore()
  const taskStore = new TaskStore()
  const runStore = new RunStore()
  const goalStore = new GoalStore()
  const teamStore = new TeamStore()
  const messageStore = new MessageStore()

  // EventBus
  const eventBus = new EventBus()

  // Services
  const agentService = new AgentService(agentStore, eventBus)
  const taskService = new TaskService(taskStore, eventBus)
  const runService = new RunService(runStore, eventBus)
  const goalService = new GoalService(goalStore, eventBus)
  const teamService = new TeamService(teamStore, eventBus)
  const messageService = new MessageService(messageStore, eventBus)

  return {
    eventBus,
    stores: {
      agent: agentStore,
      task: taskStore,
      run: runStore,
      goal: goalStore,
      team: teamStore,
      message: messageStore,
    },
    services: {
      agent: agentService,
      task: taskService,
      run: runService,
      goal: goalService,
      team: teamService,
      message: messageService,
    },
  }
}

export async function buildFullContainer(configPath?: string): Promise<FullContainer> {
  const config = loadConfig(configPath)
  const light = buildLightContainer(configPath)

  // Seed domain agents from the at registry
  const existingAgents = await light.services.agent.list()
  const existingNames = new Set(existingAgents.map(a => a.name))
  for (const agentDef of AGENTS) {
    if (!existingNames.has(agentDef.name)) {
      await light.services.agent.create({
        name: agentDef.name,
        adapter: agentDef.name,
        role: agentDef.tier === 1 ? 'architect' : agentDef.tier === 2 ? 'developer' : 'assistant',
        config: { tier: agentDef.tier },
      })
    }
  }

  // Adapters from agent registry
  const adapters = new Map<string, AgentAdapter>()
  for (const agentDef of AGENTS) {
    adapters.set(agentDef.name, createAdapterForAgent(agentDef))
  }

  // Infrastructure
  const processManager = new ProcessManager()
  const workspaceManager = new InPlaceWorkspaceManager()

  // Orchestrator
  const orchestrator = new Orchestrator(
    {
      agent: light.services.agent,
      task: light.services.task,
      run: light.services.run,
      goal: light.services.goal,
    },
    adapters,
    processManager,
    workspaceManager,
    light.eventBus,
    {
      pollIntervalMs: config.pollIntervalMs,
      stallTimeoutMs: config.stallTimeoutMs,
      maxConcurrentRuns: config.maxConcurrentAgents,
      maxRetryAttempts: config.maxRetryAttempts,
    },
  )

  return {
    ...light,
    orchestrator,
    adapters,
    processManager,
    workspaceManager,
    config,
  }
}
