import { execFile as _execFile } from 'child_process'
import { promisify } from 'util'
import type { ComposeWorkspace } from '../../infrastructure/workspace/compose-workspace'

const execFileAsync = promisify(_execFile)

export async function runTestStage(workspace: ComposeWorkspace, testCmd = 'npm test'): Promise<void> {
  const prompt = 'Run the test suite using: `' + testCmd + '`\nCapture output. If tests fail, list each failing test and reason. Write a summary.'
  const { stdout } = await execFileAsync('at', ['-t', '2', '-s', '-p', prompt], { cwd: workspace.goalDir })
  await workspace.write('test-results.md', '# Test Results\n\n' + (stdout || '(no output)'))
}
