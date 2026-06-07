import { execFile as _execFile } from 'child_process'
import { promisify } from 'util'
import type { ComposeWorkspace } from '../../infrastructure/workspace/compose-workspace'

const execFileAsync = promisify(_execFile)

export async function runReviewStage(workspace: ComposeWorkspace): Promise<void> {
  const prompt = 'Review the code changes made in this session.\nCheck: correctness, edge cases, security, performance, code style.\nList findings by severity (critical / warning / info).\nWrite a structured review.'
  const { stdout } = await execFileAsync('at', ['-t', '1', '-s', '-p', prompt], { cwd: workspace.goalDir })
  await workspace.write('review.md', '# Code Review\n\n' + (stdout || '(no output)'))
}
