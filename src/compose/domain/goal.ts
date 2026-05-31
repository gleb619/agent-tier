type GoalStatus = 'pending' | 'active' | 'completed' | 'abandoned'

interface Goal {
  id: string
  title: string
  description?: string
  status: GoalStatus
  prompt: string
  createdAt: string
  updatedAt: string
}

function createGoal(input: {
  title: string
  prompt: string
  description?: string
}): Goal {
  const now = new Date().toISOString()
  return {
    id: crypto.randomUUID(),
    title: input.title,
    description: input.description,
    status: 'pending',
    prompt: input.prompt,
    createdAt: now,
    updatedAt: now,
  }
}

export type { Goal, GoalStatus }
export { createGoal }
