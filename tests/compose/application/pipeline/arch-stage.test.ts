import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm, writeFile } from 'fs/promises'
import os from 'os'
import path from 'path'
import { ComposeWorkspace } from '../../../../src/compose/infrastructure/workspace/compose-workspace'

vi.mock('../../../../src/commands/codegraph', () => ({
  getCodegraphContext: vi.fn().mockResolvedValue('## Context\nsome symbols'),
}))

vi.mock('child_process', async (importOriginal) => {
  const orig = await importOriginal()
  return { ...orig, execFile: vi.fn() }
})

vi.mock('../../../../src/compose/application/pipeline/pi-context-probe', () => ({
  probeCodegraphQuery: vi.fn().mockImplementation((goal: string) => Promise.resolve(goal)),
}))

import { runArchStage } from '../../../../src/compose/application/pipeline/arch-stage'
import { execFile } from 'child_process'

let tmpBase: string

beforeEach(async () => {
  tmpBase = await mkdtemp(path.join(os.tmpdir(), 'arch-stage-'))
  vi.clearAllMocks()
})
afterEach(async () => {
  await rm(tmpBase, { recursive: true, force: true })
})

describe('runArchStage', () => {
  it('writes context.md and calls at with arch prompt, validates 3 files exist', async () => {
    const ws = new ComposeWorkspace('goal-1', tmpBase)
    await ws.ensure()
    vi.mocked(execFile).mockImplementation((_bin, _args, _opts, cb) => {
      Promise.all([
        writeFile(path.join(ws.goalDir, 'requirements.md'), '# Req'),
        writeFile(path.join(ws.goalDir, 'design.md'), '# Design'),
        writeFile(path.join(ws.goalDir, 'tasks.md'), '- [ ] 1. Do it'),
      ]).then(() => (cb as any)(null, '', ''))
      return {} as any
    })
    await runArchStage({ workspace: ws, goalPrompt: 'build auth feature' })
    expect(await ws.exists('context.md')).toBe(true)
    const ctx = await ws.read('context.md')
    expect(ctx).toContain('some symbols')
    expect(await ws.hasArchOutput()).toBe(true)
  })

  it('throws if arch agent does not produce all 3 files', async () => {
    const ws = new ComposeWorkspace('goal-2', tmpBase)
    await ws.ensure()
    vi.mocked(execFile).mockImplementation((_bin, _args, _opts, cb) => {
      writeFile(path.join(ws.goalDir, 'requirements.md'), '# Req').then(() => (cb as any)(null, '', ''))
      return {} as any
    })
    await expect(runArchStage({ workspace: ws, goalPrompt: 'build auth' })).rejects.toThrow('arch stage incomplete')
  })
})