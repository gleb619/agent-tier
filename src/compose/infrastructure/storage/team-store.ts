import { Team } from '../../domain'
import { ITeamStore } from '../../application/ports'
import { FsStore } from './fs-store'

export class TeamStore extends FsStore<Team> implements ITeamStore {
  constructor(storageDir?: string) {
    super('teams', storageDir)
  }

  async getByGoal(goalId: string): Promise<Team[]> {
    const all = await this.getAll()
    return all.filter((t) => t.goalId === goalId)
  }
}
