import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm } from 'fs/promises'
import os from 'os'
import path from 'path'
import { ComposeWorkspace } from '../../../../src/compose/infrastructure/workspace/compose-workspace'

vi.mock('child_process', async (importOriginal) => {
  const orig = await importOriginal()
  return { ...orig, execFile: vi.fn() }
})

import { runDevStage } from '../../../../src/compose/application/pipeline/dev-stage'
import { execFile } from 'child_process'
import { parseChecklist } from '../../../../src/compose/infrastructure/md/md-state'

let tmpBase: string

beforeEach(async () => {
  tmpBase = await mkdtemp(path.join(os.tmpdir(), 'dev-stage-'))
  vi.clearAllMocks()
})
afterEach(async () => {
  await rm(tmpBase, { recursive: true, force: true })
})

describe('runDevStage', () => {
  it('dispatches unchecked tasks and marks them done', async () => {
    const ws = new ComposeWorkspace('goal-1', tmpBase)
    await ws.write('requirements.md', '# Req')
    await ws.write('design.md', '# Design')
    await ws.write('tasks.md', '- [ ] 1. Create types\n- [x] 2. Already done\n- [ ] 3. Wire routing\n')
    vi.mocked(execFile).mockImplementation((_bin, _args, _opts, cb) => {
      (cb as any)(null, '', '')
      return {} as any
    })
    await runDevStage(ws)
    const updated = await ws.read('tasks.md')
    const items = parseChecklist(updated)
    expect(items.every(i => i.checked)).toBe(true)
    expect(vi.mocked(execFile)).toHaveBeenCalledTimes(2)
  })

  it('skips already-checked tasks', async () => {
    const ws = new ComposeWorkspace('goal-2', tmpBase)
    await ws.write('requirements.md', '')
    await ws.write('design.md', '')
    await ws.write('tasks.md', '- [x] 1. Done\n- [x] 2. Also done\n')
    await runDevStage(ws)
    expect(vi.mocked(execFile)).not.toHaveBeenCalled()
  })
})