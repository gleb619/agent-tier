import { describe, it, expect, vi, afterEach } from 'vitest'
import { Command } from 'commander'
import { registerComposeCommand, type ComposeCliOptions } from '../../src/compose/cli'

function build(run: (opts: ComposeCliOptions) => Promise<number>, goalId = 'fixed-id') {
  const logs: string[] = []
  const errors: string[] = []
  const program = new Command()
  program.name('at')
  program.exitOverride()
  registerComposeCommand(program, { run, log: m => logs.push(m), error: m => errors.push(m), newGoalId: () => goalId })
  return { program, logs, errors }
}

async function parse(program: Command, args: string[]): Promise<void> {
  await program.parseAsync(['node', 'at', 'compose', ...args])
}

describe('compose command — option parsing', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('passes goal and defaults to the run dep', async () => {
    let seen: ComposeCliOptions | undefined
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never)
    const { program } = build(async opts => {
      seen = opts
      return 0
    })

    await parse(program, ['-p', 'make retries work'])

    expect(seen).toEqual({ goal: 'make retries work', goalId: 'fixed-id', testCmd: 'npm test', maxRounds: 3, maxNodes: 30 })
    expect(exitSpy).toHaveBeenCalledWith(0)
  })

  it('accepts --goal as an alias for --prompt', async () => {
    let seen: ComposeCliOptions | undefined
    vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never)
    const { program } = build(async opts => {
      seen = opts
      return 0
    })

    await parse(program, ['--goal', 'alias goal'])

    expect(seen?.goal).toBe('alias goal')
  })

  it('parses --test-cmd, --max-rounds and --max-nodes', async () => {
    let seen: ComposeCliOptions | undefined
    vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never)
    const { program } = build(async opts => {
      seen = opts
      return 0
    })

    await parse(program, ['-p', 'g', '--test-cmd', 'npm run check', '--max-rounds', '5', '--max-nodes', '12'])

    expect(seen).toMatchObject({ testCmd: 'npm run check', maxRounds: 5, maxNodes: 12 })
  })

  it('uses --resume <id> as the goal id', async () => {
    let seen: ComposeCliOptions | undefined
    vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never)
    const { program } = build(async opts => {
      seen = opts
      return 0
    })

    await parse(program, ['-p', 'g', '--resume', 'goal-abc'])

    expect(seen?.goalId).toBe('goal-abc')
  })

  it('exits 1 when the run reports a non-DONE state', async () => {
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never)
    const { program, logs } = build(async () => 1)

    await parse(program, ['-p', 'g'])

    expect(exitSpy).toHaveBeenCalledWith(1)
    expect(logs.join('\n')).toContain('fixed-id')
  })

  it('exits 1 and reports the error when the run throws', async () => {
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never)
    const { program, errors } = build(async () => {
      throw new Error('compose CHECK: missing verdict.md')
    })

    await parse(program, ['-p', 'g'])

    expect(exitSpy).toHaveBeenCalledWith(1)
    expect(errors.join('\n')).toContain('compose CHECK: missing verdict.md')
  })
})

describe('compose command — missing prompt', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('exits 1 without running', async () => {
    const run = vi.fn(async () => 0)
    const exitSpy = vi
      .spyOn(process, 'exit')
      .mockImplementation(((code?: number) => {
        throw new Error(`exit ${code}`)
      }) as never)
    const { program, errors } = build(run)

    await expect(parse(program, [])).rejects.toThrow('exit 1')
    expect(run).not.toHaveBeenCalled()
    expect(errors.join('\n')).toMatch(/--prompt|--goal/)
  })
})
