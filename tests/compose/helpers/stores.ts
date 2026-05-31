import { join } from 'path'
import { homedir } from 'os'
import { AgentStore } from '../../../src/compose/infrastructure/storage/agent-store'
import { TaskStore } from '../../../src/compose/infrastructure/storage/task-store'
import { RunStore } from '../../../src/compose/infrastructure/storage/run-store'
import { GoalStore } from '../../../src/compose/infrastructure/storage/goal-store'
import { TeamStore } from '../../../src/compose/infrastructure/storage/team-store'
import { MessageStore } from '../../../src/compose/infrastructure/storage/message-store'

export { AgentStore, TaskStore, RunStore, GoalStore, TeamStore, MessageStore }

export function projectPathToNamespace(projectPath: string): string {
  return projectPath.replace(/\//g, '_').replace(/^_+/, '')
}

export function makeStores(projectPath: string = process.cwd(), baseDir?: string) {
  const storeBase = baseDir ?? join(homedir(), '.at', 'compose', projectPathToNamespace(projectPath))
  return {
    agents: new AgentStore(storeBase),
    tasks: new TaskStore(storeBase),
    runs: new RunStore(storeBase),
    goals: new GoalStore(storeBase),
    teams: new TeamStore(storeBase),
    messages: new MessageStore(storeBase),
  }
}
