import { Goal } from '../../domain'
import { IGoalStore } from '../../application/ports'
import { FsStore } from './fs-store'

export class GoalStore extends FsStore<Goal> implements IGoalStore {
  constructor(storageDir?: string) {
    super('goals', storageDir)
  }
}
