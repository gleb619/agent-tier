import { Command } from 'commander'
import { buildFullContainer } from './container'

export function registerComposeCommand(program: Command): void {
  program
    .command('compose')
    .description('Orchestrate multiple AI agents to complete a goal')
    .option('-p, --prompt <text>', 'Goal prompt')
    .option('--goal <text>', 'Alias for --prompt')
    .option('--stream', 'Stream output from agents')
    .option('--config <path>', 'Path to compose config file')
    .option('--team <name>', 'Team name (future use)')
    .action(async (options) => {
      const prompt = options.prompt || options.goal
      if (!prompt) {
        console.error('[compose] Error: --prompt or --goal is required')
        process.exit(1)
      }

      const container = buildFullContainer(options.config)

      const goal = await container.services.goal.create({
        title: prompt.slice(0, 80),
        prompt,
      })

      await container.orchestrator.start()
      console.log('[compose] Orchestrator started. Goal: ' + goal.title)

      if (options.stream) {
        container.eventBus.on('orchestrator:tick', (e) => {
          console.log('[tick]', JSON.stringify(e.payload))
        })
      }

      process.on('SIGINT', async () => {
        await container.orchestrator.stop()
        process.exit(0)
      })

      process.on('SIGTERM', async () => {
        await container.orchestrator.stop()
        process.exit(0)
      })

      // Keep process alive until SIGINT/SIGTERM
      await new Promise(() => {})
    })
}
