import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm, stat } from 'fs/promises'
import os from 'os'
import path from 'path'
import { ComposeWorkspace } from '../../../../src/compose/infrastructure/workspace/compose-workspace'

let tmpBase: string

beforeEach(async () => {
  tmpBase = await mkdtemp(path.join(os.tmpdir(), 'compose-ws-'))
})

afterEach(async () => {
  await rm(tmpBase, { recursive: true, force: true })
})

describe('ComposeWorkspace', () => {
  it('creates goalDir under baseDir', async () => {
    const ws = new ComposeWorkspace('goal-123', tmpBase)
    await ws.ensure()
    const s = await stat(ws.goalDir)
    expect(s.isDirectory()).toBe(true)
  })

  it('writes and reads a file', async () => {
    const ws = new ComposeWorkspace('goal-abc', tmpBase)
    await ws.write('tasks.md', '# Tasks\n- [ ] 1. Do thing\n')
    const content = await ws.read('tasks.md')
    expect(content).toContain('Do thing')
  })

  it('exists() returns correct values', async () => {
    const ws = new ComposeWorkspace('goal-abc', tmpBase)
    await ws.write('design.md', '# Design')
    expect(await ws.exists('design.md')).toBe(true)
    expect(await ws.exists('missing.md')).toBe(false)
  })

  it('hasArchOutput() only true with all 3 files', async () => {
    const ws = new ComposeWorkspace('goal-xyz', tmpBase)
    expect(await ws.hasArchOutput()).toBe(false)
    await ws.write('requirements.md', '')
    await ws.write('design.md', '')
    expect(await ws.hasArchOutput()).toBe(false)
    await ws.write('tasks.md', '')
    expect(await ws.hasArchOutput()).toBe(true)
  })
})