import type { IEventBus } from '../event-bus'
import { createTask, transitionTask, type Task, type TaskStatus, type TaskPriority, type TaskStage } from '../../domain'
import type { ITaskStore } from '../ports'

export interface CreateTaskInput {
  title: string
  description?: string
  priority?: TaskPriority
  stage?: TaskStage
  scope?: string[]
  dependsOn?: string[]
  goalId?: string
  maxAttempts?: number
}

export class TaskService {
  constructor(
    private readonly store: ITaskStore,
    private readonly eventBus: IEventBus,
  ) {}

  async create(input: CreateTaskInput): Promise<Task> {
    const task = createTask(input)
    await this.store.save(task)
    return task
  }

  async assign(taskId: string, agentId: string): Promise<void> {
    const task = await this.store.get(taskId)
    if (!task) return

    task.assignee = agentId
    task.updatedAt = new Date().toISOString()
    await this.store.save(task)

    this.eventBus.emit({
      id: crypto.randomUUID(),
      type: 'task:assigned',
      timestamp: new Date().toISOString(),
      payload: { taskId, agentId },
    })
  }

  async updateStatus(taskId: string, status: TaskStatus): Promise<void> {
    const task = await this.store.get(taskId)
    if (!task) return

    const updated = transitionTask(task, status)
    await this.store.save(updated)

    this.eventBus.emit({
      id: crypto.randomUUID(),
      type: 'task:status_changed',
      timestamp: new Date().toISOString(),
      payload: { taskId, from: task.status, to: status },
    })
  }

  async cancel(taskId: string): Promise<void> {
    await this.updateStatus(taskId, 'cancelled')
  }

  async retry(taskId: string): Promise<void> {
    const task = await this.store.get(taskId)
    if (!task) return

    // Transitions to retrying then to todo (via transitionTask for retrying)
    const updated = transitionTask(task, 'retrying')
    await this.store.save(updated)

    // Immediately transition to todo
    const toTodo = { ...updated, status: 'todo' as const, updatedAt: new Date().toISOString() }
    await this.store.save(toTodo)

    this.eventBus.emit({
      id: crypto.randomUUID(),
      type: 'run:retry',
      timestamp: new Date().toISOString(),
      payload: { runId: '', taskId, agentId: '', attempt: toTodo.attempts, delayMs: 0 },
    })
  }

  async getByGoal(goalId: string): Promise<Task[]> {
    return this.store.getByGoal(goalId)
  }

  async getReadyTasks(): Promise<Task[]> {
    const tasks = await this.store.getByStatus('todo')
    const allTasks = await this.store.getAll()

    // Filter: all dependencies satisfied
    return tasks.filter(task => {
      if (task.dependsOn.length === 0) return true

      return task.dependsOn.every(depId => {
        const dep = allTasks.find(t => t.id === depId)
        return dep?.status === 'done'
      })
    })
  }

  async get(taskId: string): Promise<Task | undefined> {
    return this.store.get(taskId)
  }

  async getAll(): Promise<Task[]> {
    return this.store.getAll()
  }
}