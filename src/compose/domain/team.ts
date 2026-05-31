type TeamStatus = 'forming' | 'active' | 'disbanded'

interface Team {
  id: string
  name: string
  status: TeamStatus
  memberIds: string[]
  leadId?: string
  goalId?: string
  createdAt: string
  updatedAt: string
}

function createTeam(input: {
  name: string
  memberIds: string[]
  leadId?: string
  goalId?: string
}): Team {
  const now = new Date().toISOString()
  return {
    id: crypto.randomUUID(),
    name: input.name,
    status: 'forming',
    memberIds: input.memberIds,
    leadId: input.leadId,
    goalId: input.goalId,
    createdAt: now,
    updatedAt: now,
  }
}

export type { Team, TeamStatus }
export { createTeam }
