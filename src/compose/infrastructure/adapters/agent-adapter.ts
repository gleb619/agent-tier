import { spawn } from 'child_process'
import * as readline from 'readline'
import type { AgentDef } from '../../../agents/registry'
import type { IAgentAdapter, AdapterAgentEvent, ExecuteParams, AdapterTestResult } from '../../application/ports'
import type { TokenUsage } from '../../domain'

export class AgentAdapter implements IAgentAdapter {
  readonly kind: string

  constructor(private readonly agentDef: AgentDef) {
    this.kind = agentDef.name
  }

  async test(): Promise<AdapterTestResult> {
    const start = Date.now()
    return new Promise((resolve) => {
      try {
        const bin = this.agentDef.bin()
        const child = spawn(bin, ['--version'], { stdio: 'ignore' })
        child.on('close', (code) => {
          resolve({ ok: code === 0, latencyMs: Date.now() - start })
        })
        child.on('error', (err) => {
          resolve({ ok: false, error: err.message, latencyMs: Date.now() - start })
        })
      } catch (err) {
        resolve({ ok: false, error: String(err), latencyMs: Date.now() - start })
      }
    })
  }

  execute(params: ExecuteParams): { pid: number; output: AsyncGenerator<AdapterAgentEvent> } {
    const { agentDef } = this
    const bin = agentDef.bin()
    const useStdin = agentDef.promptMode === 'stdin'
    const args = useStdin ? agentDef.buildArgs('') : agentDef.buildArgs(params.prompt)
    const extraEnv = agentDef.buildEnv?.() ?? {}
    const env = { ...process.env, ...extraEnv, ...(params.env ?? {}) } as Record<string, string>

    const child = spawn(bin, args, {
      cwd: params.cwd,
      env,
      stdio: useStdin ? ['pipe', 'pipe', 'pipe'] : ['ignore', 'pipe', 'pipe'],
    })

    if (child.pid === undefined) {
      throw new Error(`Failed to spawn ${agentDef.name}: no PID`)
    }

    if (useStdin && child.stdin) {
      child.stdin.write(params.prompt)
      child.stdin.end()
    }

    const pid = child.pid
    const output = this.buildOutputGenerator(child)
    return { pid, output }
  }

  private async *buildOutputGenerator(
    child: ReturnType<typeof spawn>,
  ): AsyncGenerator<AdapterAgentEvent> {
    const rl = readline.createInterface({ input: child.stdout!, crlfDelay: Infinity })

    const lines: string[] = []
    const lineEvent = new Promise<void>((resolve) => {
      rl.on('line', (line) => {
        lines.push(line)
        resolve()
      })
    })

    let exitCode = 0
    let done = false
    let tokenUsage: TokenUsage | undefined

    child.on('close', (code) => {
      exitCode = code ?? 1
      done = true
    })

    child.on('error', () => {
      done = true
      exitCode = 1
    })

    // Stream stdout lines
    for await (const line of rl) {
      yield { type: 'output', chunk: line }
      if (done) break
    }

    rl.close()

    yield { type: 'done', exitCode, tokenUsage }
  }

  async stop(pid: number): Promise<void> {
    try {
      process.kill(pid, 'SIGTERM')
    } catch {
      return
    }
    await new Promise<void>((r) => setTimeout(r, 5000))
    try {
      process.kill(pid, 'SIGKILL')
    } catch {
      // already dead
    }
  }
}

export function createAdapterForAgent(agentDef: AgentDef): AgentAdapter {
  return new AgentAdapter(agentDef)
}
