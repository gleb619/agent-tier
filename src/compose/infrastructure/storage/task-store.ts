import { Task, TaskStatus } from '../../domain'
import { ITaskStore } from '../../application/ports'
import { FsStore } from './fs-store'

export class TaskStore extends FsStore<Task> implements ITaskStore {
  constructor(storageDir?: string) {
    super('tasks', storageDir)
  }

  async getByGoal(goalId: string): Promise<Task[]> {
    const all = await this.getAll()
    return all.filter((t) => t.goalId === goalId)
  }

  async getByStatus(status: TaskStatus): Promise<Task[]> {
    const all = await this.getAll()
    return all.filter((t) => t.status === status)
  }

  async getByAssignee(agentId: string): Promise<Task[]> {
    const all = await this.getAll()
    return all.filter((t) => t.assignee === agentId)
  }
}
