import { Command } from 'commander'
import { exec as _exec, execFile as _execFile } from 'child_process'
import { readFileSync } from 'fs'
import { promisify } from 'util'
import { ComposeWorkspace } from './workspace'
import { loadState } from './state'
import { runCompose, type CommandResult, type ComposeDeps } from './machine'
import { taskGoal, type ComposeTask, type TaskFinishInfo, type TaskSource } from './task-source'
import { createKanbanSource } from './kanban-source'
import { resolveBoardFile } from '../kanban/board'
import { DEFAULT_MAX_NODES, DEFAULT_MAX_ROUNDS, DEFAULT_TEST_CMD } from './state'
import { getCodegraphContext } from '../commands/codegraph'
import { resolveStateDir } from '../state-dir'
import { loadRuns } from '../run-store'
import { unansweredQuestions } from '../notify/discuss-store'
import { postDiscussEntry } from '../commands/discuss-helpers'
import type { DiscussEntry } from '../notify/types'

const execAsync = promisify(_exec)
const execFileAsync = promisify(_execFile)
const MAX_BUFFER = 32 * 1024 * 1024
const WAIT_POLL_MS = 2000
const MAX_LOG_TAIL = 4000

export interface ComposeCliOptions {
  goal: string
  goalId: string
  testCmd: string
  maxRounds: number
  maxNodes: number
  maxQuestions: number
  /** Set when composing a kanban task (goal text is derived from it). */
  task?: ComposeTask
  /** Kanban source: machine fires onPhase/onFinish against the board. */
  source?: TaskSource
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
  task?: string
  board?: string
  loop?: boolean
  stopOnFail?: boolean
  testCmd: string
  maxRounds: number
  maxNodes: number
  maxQuestions: number
  resume?: string
}

export interface BoardTasksOptions {
  board?: string
  /** Compose one specific kanban task by id. */
  taskId?: string
  /** Keep claiming + composing until the board has no executable task. */
  loop: boolean
  /** Stop the loop after the first FAILED run (default: FAILED → Blocked, loop continues). */
  stopOnFail: boolean
  runOne: (opts: ComposeCliOptions) => Promise<number>
  log: (msg: string) => void
  /** Test seam: where per-goal compose state lives. Defaults to ~/.at/compose. */
  workspaceFor?: (goalId: string) => ComposeWorkspace
}

function isTerminalPhase(state: string | undefined): state is 'DONE' | 'FAILED' {
  return state === 'DONE' || state === 'FAILED'
}

/**
 * Drive compose from a kanban board: claim a task (goalId = lowercase task id,
 * so state.json under ~/.at/compose/<id>/ makes --resume implicit), compose it,
 * repeat while `loop`. Exit code: 0 when no task FAILED, else 1.
 */
export async function runBoardTasks(
  params: Pick<ComposeCliOptions, 'testCmd' | 'maxRounds' | 'maxNodes' | 'maxQuestions'>,
  opts: BoardTasksOptions,
): Promise<number> {
  const workspaceFor = opts.workspaceFor ?? ((id: string) => new ComposeWorkspace(id))
  const source = createKanbanSource({ boardFile: resolveBoardFile(opts.board), log: opts.log })
  const finish = async (task: ComposeTask, outcome: 'DONE' | 'FAILED', info: TaskFinishInfo): Promise<void> => {
    try {
      await source.onFinish(task, outcome, info)
    } catch (err) {
      opts.log(`[compose] onFinish error for ${task.id}: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  let anyFailed = false
  let claimedSpecific = false
  for (;;) {
    const task = opts.taskId
      ? claimedSpecific
        ? null
        : ((claimedSpecific = true), await source.claimId(opts.taskId))
      : await source.claim()
    if (!task) {
      if (opts.taskId) return 1 // explicitly requested task not found
      break
    }

    const goalId = task.id.toLowerCase()
    const ws = workspaceFor(goalId)
    const saved = await loadState(ws)
    if (saved && isTerminalPhase(saved.state)) {
      await finish(task, saved.state, { goalDir: ws.goalDir, round: saved.round })
      if (saved.state === 'FAILED') anyFailed = true
      if (saved.state === 'FAILED' && opts.stopOnFail) break
      if (!opts.loop || opts.taskId) break
      continue
    }

    const goal = await taskGoal(task)
    const code = await opts.runOne({ goal, goalId, task, source, ...params })
    if (code !== 0) {
      anyFailed = true
      if (opts.stopOnFail) break
    }
    if (!opts.loop || opts.taskId) break
  }
  return anyFailed ? 1 : 0
}

function failure(err: unknown): CommandResult {
  const e = err as { code?: unknown; stdout?: string; stderr?: string; message?: string }
  const code = typeof e.code === 'number' ? e.code : 1
  return { code, output: `${e.stdout ?? ''}${e.stderr ?? e.message ?? ''}` }
}

/** Real deps: shell out to `at` for agent calls, to a shell for local commands. */
export function createComposeDeps(workspace: ComposeWorkspace, stateDir = resolveStateDir()): ComposeDeps {
  return {
    workspace,
    stateDir,
    async startAt(tier, prompt, cwd) {
      // Detached start (no -s): `at` prints the run box and returns immediately.
      const { stdout } = await execFileAsync(
        'at',
        ['-t', String(tier), '--state-dir', stateDir, '-p', prompt],
        { cwd, maxBuffer: MAX_BUFFER },
      )
      const m = /Run ID:\s*(\S+)/.exec(stdout)
      if (!m) throw new Error(`compose: could not parse Run ID from at output: ${stdout.slice(0, 200)}`)
      return { runId: m[1] }
    },
    async waitRun(runId, { onQuestion }) {
      const attempted = new Set<string>()
      for (;;) {
        for (const q of unansweredQuestions(stateDir, runId)) {
          if (attempted.has(q.id)) continue
          attempted.add(q.id)
          const answer = await onQuestion(q)
          if (answer && answer.trim()) {
            await postDiscussEntry(
              runId,
              { from: 'host', kind: 'answer', text: answer.trim(), replyTo: q.id },
              stateDir,
            )
          }
        }
        const rec = loadRuns(stateDir).find(r => r.runId === runId)
        if (rec && rec.status !== 'running') {
          // A detached run's real exit code is unknowable: done → 0, failed/stuck → 1.
          const code = rec.status === 'done' ? (rec.exitCode ?? 0) : (rec.exitCode ?? 1)
          return { code, output: logTail(rec.logFile) }
        }
        await new Promise(r => setTimeout(r, WAIT_POLL_MS))
      }
    },
    async askBrain(prompt) {
      const { stdout, stderr } = await execFileAsync(
        'at',
        ['-t', '1', '--state-dir', stateDir, '-s', '-p', prompt],
        { maxBuffer: MAX_BUFFER },
      )
      return `${stdout}${stderr}`
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

function logTail(logFile: string): string {
  try {
    const content = readFileSync(logFile, 'utf8')
    return content.length > MAX_LOG_TAIL ? content.slice(-MAX_LOG_TAIL) : content
  } catch {
    return ''
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
          task: opts.task,
          source: opts.source,
          testCmd: opts.testCmd,
          maxRounds: opts.maxRounds,
          maxNodes: opts.maxNodes,
          maxQuestions: opts.maxQuestions,
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
    .option('--max-questions <number>', 'Max brain answers per agent run during IMPLEMENT', (v) => parseInt(v, 10), 5)
    .option('--resume <id>', 'Resume a saved goal by id (continues from state.json)')
    .option('--task <id>', 'Compose one kanban task by id (claims and marks it In Progress)')
    .option('--loop', 'Claim and compose board tasks until none are executable', false)
    .option('--board <file>', 'Kanban board file for --task/--loop (default: resolved project board)')
    .option('--stop-on-fail', 'With --loop: stop after the first FAILED run', false)
    .action(async (args: ComposeCliArgs) => {
      const prompt = args.prompt ?? args.goal
      if (args.task || args.loop) {
        if (prompt) {
          error('[compose] Error: --prompt/--goal cannot be combined with --task/--loop')
          process.exit(1)
          return
        }
        try {
          process.exit(
            await runBoardTasks(
              {
                testCmd: args.testCmd,
                maxRounds: args.maxRounds,
                maxNodes: args.maxNodes,
                maxQuestions: args.maxQuestions,
              },
              {
                board: args.board,
                taskId: args.task,
                loop: args.loop ?? false,
                stopOnFail: args.stopOnFail ?? false,
                runOne: run,
                log,
              },
            ),
          )
        } catch (err) {
          error(`[compose] ${err instanceof Error ? err.message : String(err)}`)
          process.exit(1)
        }
        return
      }
      if (!prompt) {
        error('[compose] Error: --prompt or --goal is required (or use --task/--loop with a board)')
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
            maxQuestions: args.maxQuestions,
          }),
        )
      } catch (err) {
        error(`[compose] ${err instanceof Error ? err.message : String(err)}`)
        process.exit(1)
      }
    })
}
