import { Command } from 'commander'
import { ComposeWorkspace } from '../infrastructure/workspace/compose-workspace'
import { PipelineService } from '../application/pipeline/pipeline-service'

export function registerComposeCommand(program: Command): void {
  program
    .command('compose')
    .description('Orchestrate multiple AI agents to complete a goal')
    .option('-p, --prompt <text>', 'Goal prompt')
    .option('--goal <text>', 'Alias for --prompt')
    .option('--test-cmd <cmd>', 'Test command to run in test stage', 'npm test')
    .option('--max-nodes <number>', 'Max codegraph nodes for arch context', (v) => parseInt(v, 10), 30)
    .action(async (options) => {
      const prompt = options.prompt || options.goal
      if (!prompt) {
        console.error('[compose] Error: --prompt or --goal is required')
        process.exit(1)
      }

      const goalId = crypto.randomUUID()
      const workspace = new ComposeWorkspace(goalId)
      await workspace.ensure()

      console.log('[compose] Goal workspace: ' + workspace.goalDir)

      const pipeline = new PipelineService(workspace, prompt, {
        testCmd: options.testCmd,
        maxNodes: options.maxNodes,
      })

      process.on('SIGINT', () => {
        console.log('\n[compose] Interrupted. Resume by re-running with same goal — unchecked tasks in tasks.md will continue.')
        process.exit(0)
      })
      process.on('SIGTERM', () => process.exit(0))

      await pipeline.run(() => {
        console.log('[compose] Pipeline complete. Results in: ' + workspace.goalDir)
      })

      process.exit(0)
    })
}
