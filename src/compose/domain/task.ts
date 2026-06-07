type TaskStatus = 'todo' | 'in_progress' | 'review' | 'done' | 'failed' | 'cancelled' | 'retrying'
type TaskPriority = 'low' | 'medium' | 'high' | 'critical'
type TaskStage = 'arch' | 'dev' | 'test' | 'review'

interface Task {
  id: string
  title: string
  description?: string
  status: TaskStatus
  priority: TaskPriority
  stage: TaskStage
  assignee?: string
  labels: string[]
  dependsOn: string[]
  scope: string[]
  attempts: number
  maxAttempts: number
  goalId?: string
  result?: string
  createdAt: string
  updatedAt: string
}

function createTask(input: {
  title: string
  description?: string
  priority?: TaskPriority
  stage?: TaskStage
  scope?: string[]
  dependsOn?: string[]
  goalId?: string
  maxAttempts?: number
}): Task {
  const now = new Date().toISOString()
  return {
    id: crypto.randomUUID(),
    title: input.title,
    description: input.description,
    status: 'todo',
    priority: input.priority ?? 'medium',
    stage: input.stage ?? 'dev',
    labels: [],
    dependsOn: input.dependsOn ?? [],
    scope: input.scope ?? [],
    attempts: 0,
    maxAttempts: input.maxAttempts ?? 3,
    goalId: input.goalId,
    createdAt: now,
    updatedAt: now,
  }
}

export type { Task, TaskStatus, TaskPriority, TaskStage }
export { createTask }
