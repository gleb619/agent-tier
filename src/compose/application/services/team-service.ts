import type { IEventBus } from '../event-bus'
import { createTeam, type Team } from '../../domain'
import type { ITeamStore } from '../ports'

export class TeamService {
  constructor(
    private readonly store: ITeamStore,
    private readonly eventBus: IEventBus,
  ) {}

  async create(input: { name: string; memberIds: string[]; leadId?: string; goalId?: string }): Promise<Team> {
    throw new Error('not implemented')
  }

  async addMember(teamId: string, agentId: string): Promise<void> {
    throw new Error('not implemented')
  }

  async removeMember(teamId: string, agentId: string): Promise<void> {
    throw new Error('not implemented')
  }

  async claimTask(teamId: string, taskId: string): Promise<void> {
    throw new Error('not implemented')
  }

  async disband(teamId: string): Promise<void> {
    throw new Error('not implemented')
  }
}