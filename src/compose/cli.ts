import { Command } from 'commander'
import { exec as _exec, execFile as _execFile } from 'child_process'
import { promisify } from 'util'
import { ComposeWorkspace } from './workspace'
import { runCompose, type CommandResult, type ComposeDeps } from './machine'
import { DEFAULT_MAX_NODES, DEFAULT_MAX_ROUNDS, DEFAULT_TEST_CMD } from './state'
import { getCodegraphContext } from '../commands/codegraph'

const execAsync = promisify(_exec)
const execFileAsync = promisify(_execFile)
const MAX_BUFFER = 32 * 1024 * 1024

export interface ComposeCliOptions {
  goal: string
  goalId: string
  testCmd: string
  maxRounds: number
  maxNodes: number
}

export interface ComposeCliDeps {
  run?(opts: ComposeCliOptions): Promise<number>
  log?(msg: string): void
  error?(msg: string): void
  newGoalId?(): string
}

interface ComposeCliArgs {
  prompt?: string
  goal?: string
  testCmd: string
  maxRounds: number
  maxNodes: number
  resume?: string
}

function failure(err: unknown): CommandResult {
  const e = err as { code?: unknown; stdout?: string; stderr?: string; message?: string }
  const code = typeof e.code === 'number' ? e.code : 1
  return { code, output: `${e.stdout ?? ''}${e.stderr ?? e.message ?? ''}` }
}

/** Real deps: shell out to `at` for agent calls, to a shell for local commands. */
export function createComposeDeps(workspace: ComposeWorkspace): ComposeDeps {
  return {
    workspace,
    async runAt(tier, prompt, cwd) {
      try {
        const { stdout, stderr } = await execFileAsync('at', ['-t', String(tier), '-s', '-p', prompt], {
          cwd,
          maxBuffer: MAX_BUFFER,
        })
        return { code: 0, output: `${stdout}${stderr}` }
      } catch (err) {
        return failure(err)
      }
    },
    async runCmd(cmd, cwd) {
      try {
        const { stdout, stderr } = await execAsync(cmd, { cwd, maxBuffer: MAX_BUFFER })
        return { code: 0, output: `${stdout}${stderr}` }
      } catch (err) {
        return failure(err)
      }
    },
    codegraph: (goal, maxNodes) => getCodegraphContext(goal, maxNodes),
  }
}

export function registerComposeCommand(program: Command, deps: ComposeCliDeps = {}): void {
  const log = deps.log ?? ((msg: string) => console.log(msg))
  const error = deps.error ?? ((msg: string) => console.error(msg))
  const newGoalId = deps.newGoalId ?? (() => crypto.randomUUID())
  const run =
    deps.run ??
    (async (opts: ComposeCliOptions) => {
      const workspace = new ComposeWorkspace(opts.goalId)
      const result = await runCompose(
        {
          goal: opts.goal,
          testCmd: opts.testCmd,
          maxRounds: opts.maxRounds,
          maxNodes: opts.maxNodes,
          cwd: process.cwd(),
        },
        createComposeDeps(workspace),
      )
      log(`[compose] ${result.state} after round ${result.round} — artifacts in ${result.goalDir}`)
      return result.state === 'DONE' ? 0 : 1
    })

  program
    .command('compose')
    .description('Plan (tier 1) -> implement (tier 2) -> check (tier 1) state machine for one goal')
    .option('-p, --prompt <text>', 'Goal prompt')
    .option('--goal <text>', 'Alias for --prompt')
    .option('--test-cmd <cmd>', 'Test command run during CHECK', DEFAULT_TEST_CMD)
    .option('--max-rounds <number>', 'Re-plan rounds before FAILED', (v) => parseInt(v, 10), DEFAULT_MAX_ROUNDS)
    .option('--max-nodes <number>', 'Max codegraph nodes in PLAN context', (v) => parseInt(v, 10), DEFAULT_MAX_NODES)
    .option('--resume <id>', 'Resume a saved goal by id (continues from state.json)')
    .action(async (args: ComposeCliArgs) => {
      const prompt = args.prompt ?? args.goal
      if (!prompt) {
        error('[compose] Error: --prompt or --goal is required')
        process.exit(1)
        return
      }

      const goalId = args.resume ?? newGoalId()
      log(`[compose] goal ${goalId}`)

      try {
        process.exit(
          await run({
            goal: prompt,
            goalId,
            testCmd: args.testCmd,
            maxRounds: args.maxRounds,
            maxNodes: args.maxNodes,
          }),
        )
      } catch (err) {
        error(`[compose] ${err instanceof Error ? err.message : String(err)}`)
        process.exit(1)
      }
    })
}
