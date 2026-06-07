import { execFile as _execFile } from 'child_process'
import { promisify } from 'util'
import { getCodegraphContext } from '../../../commands/codegraph'
import type { ComposeWorkspace } from '../../infrastructure/workspace/compose-workspace'

const execFileAsync = promisify(_execFile)

export interface ArchStageConfig {
  workspace: ComposeWorkspace
  goalPrompt: string
  codegraphTask?: string
  maxNodes?: number
}

export async function runArchStage(config: ArchStageConfig): Promise<void> {
  const { workspace, goalPrompt, maxNodes = 30 } = config
  const context = await getCodegraphContext(config.codegraphTask ?? goalPrompt, maxNodes)
  await workspace.write('context.md', context)
  const prompt = buildArchPrompt(goalPrompt, context)
  await execFileAsync('at', ['-t', '1', '-s', '-p', prompt], { cwd: workspace.goalDir })
  if (!(await workspace.hasArchOutput())) {
    throw new Error('arch stage incomplete: missing files in ' + workspace.goalDir)
  }
}

function buildArchPrompt(goalPrompt: string, context: string): string {
  return 'You are an architect. Goal: ' + goalPrompt + '\n\n## Codebase Context\n' + context + '\n\n## Output\nWrite exactly 3 files to the current directory:\n\n**requirements.md** — user stories + EARS acceptance criteria (no implementation details)\n\n**design.md** — mermaid architecture diagram, component interfaces, data model table, testing strategy\n\n**tasks.md** — ordered checklist:\n- [ ] 1. Task name\n  - Details\n- [ ] 2. Next task\n\nUse - [ ] for each unchecked task. Number sequentially.'
}