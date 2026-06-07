import { execFile as _execFile } from 'child_process'
import { promisify } from 'util'
import { pendingItems, setChecked } from '../../infrastructure/md/md-state'
import type { ComposeWorkspace } from '../../infrastructure/workspace/compose-workspace'

const execFileAsync = promisify(_execFile)

export async function runDevStage(workspace: ComposeWorkspace): Promise<void> {
  const [tasksContent, requirements, design] = await Promise.all([
    workspace.read('tasks.md'),
    workspace.read('requirements.md'),
    workspace.read('design.md'),
  ])
  const pending = pendingItems(tasksContent)
  for (const item of pending) {
    const prompt = buildDevPrompt(item.text, requirements, design)
    await execFileAsync('at', ['-t', '2', '-s', '-p', prompt], { cwd: workspace.goalDir })
    const current = await workspace.read('tasks.md')
    await workspace.write('tasks.md', setChecked(current, item.index, true))
  }
}

function buildDevPrompt(task: string, requirements: string, design: string): string {
  return 'Implement this task: ' + task + '\n\n## Requirements\n' + requirements + '\n\n## Design\n' + design + '\n\nImplement the code. Run tests. Commit.'
}