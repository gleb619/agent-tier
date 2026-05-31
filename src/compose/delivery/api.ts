import { buildLightContainer, buildFullContainer } from './container'
import type { DomainEvent, Task, Agent, TaskStatus } from '../domain'
import type { CreateTaskInput } from '../application/services/task-service'

export interface ComposeOptions {
  configPath?: string
  onEvent?: (event: DomainEvent) => void
  maxTicks?: number
}

export async function compose(goalText: string, options?: ComposeOptions): Promise<void> {
  const container = buildFullContainer(options?.configPath)

  await container.services.goal.create({
    title: goalText.slice(0, 80),
    prompt: goalText,
  })

  // Subscribe all domain events via onAny
  let unsubAll: (() => void) | undefined
  if (options?.onEvent) {
    unsubAll = container.eventBus.onAny(options.onEvent)
  }

  // Track ticks for maxTicks limit
  let tickCount = 0
  let resolveDone: () => void
  const done = new Promise<void>((r) => { resolveDone = r })

  const unsubTick = container.eventBus.on('orchestrator:tick' as any, () => {
    tickCount++
    if (options?.maxTicks && tickCount >= options.maxTicks) {
      container.orchestrator.stop().catch(() => {})
    }
  })

  const unsubShutdown = container.eventBus.on('orchestrator:shutdown' as any, () => {
    resolveDone()
  })

  await container.orchestrator.start()

  // Block until shutdown event fires
  await done

  unsubTick()
  unsubShutdown()
  unsubAll?.()
}

export async function createTask(input: CreateTaskInput, configPath?: string): Promise<Task> {
  const container = buildLightContainer(configPath)
  return container.services.task.create(input)
}

export async function listAgents(configPath?: string): Promise<Agent[]> {
  const container = buildLightContainer(configPath)
  return container.services.agent.list()
}

export async function listTasks(
  filter?: { status?: TaskStatus; goalId?: string },
  configPath?: string,
): Promise<Task[]> {
  const container = buildLightContainer(configPath)
  if (filter?.status) return container.stores.task.getByStatus(filter.status)
  if (filter?.goalId) return container.stores.task.getByGoal(filter.goalId)
  return container.stores.task.getAll()
}
