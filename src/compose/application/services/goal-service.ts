import type { IEventBus } from '../event-bus'
import { createGoal, type Goal, type GoalStatus } from '../../domain'
import type { IGoalStore } from '../ports'

export class GoalService {
  constructor(
    private readonly store: IGoalStore,
    private readonly eventBus: IEventBus,
  ) {}

  async create(input: { title: string; prompt: string; description?: string }): Promise<Goal> {
    const goal = createGoal(input)
    await this.store.save(goal)

    this.eventBus.emit({
      id: crypto.randomUUID(),
      type: 'goal:created',
      timestamp: new Date().toISOString(),
      payload: { goalId: goal.id, title: goal.title },
    })

    return goal
  }

  async activate(id: string): Promise<void> {
    const goal = await this.store.get(id)
    if (!goal) return

    if (goal.status !== 'pending') {
      throw new Error(`Cannot activate goal in status: ${goal.status}`)
    }

    goal.status = 'active'
    goal.updatedAt = new Date().toISOString()
    await this.store.save(goal)

    this.eventBus.emit({
      id: crypto.randomUUID(),
      type: 'goal:status_changed',
      timestamp: new Date().toISOString(),
      payload: { goalId: id, from: 'pending', to: 'active' },
    })
  }

  async complete(id: string): Promise<void> {
    const goal = await this.store.get(id)
    if (!goal) return

    if (goal.status !== 'active') {
      throw new Error(`Cannot complete goal in status: ${goal.status}`)
    }

    const previousStatus = goal.status
    goal.status = 'completed'
    goal.updatedAt = new Date().toISOString()
    await this.store.save(goal)

    this.eventBus.emit({
      id: crypto.randomUUID(),
      type: 'goal:status_changed',
      timestamp: new Date().toISOString(),
      payload: { goalId: id, from: previousStatus, to: 'completed' },
    })
  }

  async abandon(id: string): Promise<void> {
    const goal = await this.store.get(id)
    if (!goal) return

    if (goal.status !== 'active') {
      throw new Error(`Cannot abandon goal in status: ${goal.status}`)
    }

    const previousStatus = goal.status
    goal.status = 'abandoned'
    goal.updatedAt = new Date().toISOString()
    await this.store.save(goal)

    this.eventBus.emit({
      id: crypto.randomUUID(),
      type: 'goal:status_changed',
      timestamp: new Date().toISOString(),
      payload: { goalId: id, from: previousStatus, to: 'abandoned' },
    })
  }
}