import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm } from 'fs/promises'
import os from 'os'
import path from 'path'
import { ComposeWorkspace } from '../../../../src/compose/infrastructure/workspace/compose-workspace'

vi.mock('child_process', async (importOriginal) => {
  const orig = await importOriginal()
  return { ...orig, execFile: vi.fn() }
})

import { runTestStage } from '../../../../src/compose/application/pipeline/test-stage'
import { runReviewStage } from '../../../../src/compose/application/pipeline/review-stage'
import { execFile } from 'child_process'

let tmpBase: string

beforeEach(async () => {
  tmpBase = await mkdtemp(path.join(os.tmpdir(), 'test-review-'))
  vi.clearAllMocks()
})
afterEach(async () => {
  await rm(tmpBase, { recursive: true, force: true })
})

describe('runTestStage', () => {
  it('runs tests via at and writes test-results.md', async () => {
    const ws = new ComposeWorkspace('goal-1', tmpBase)
    await ws.ensure()
    vi.mocked(execFile).mockImplementation((_bin, _args, _opts, cb) => {
      (cb as any)(null, { stdout: 'All tests passed', stderr: '' })
      return {} as any
    })
    await runTestStage(ws, 'npm test')
    expect(await ws.exists('test-results.md')).toBe(true)
    const content = await ws.read('test-results.md')
    expect(content).toContain('All tests passed')
  })
})

describe('runReviewStage', () => {
  it('runs review via at and writes review.md', async () => {
    const ws = new ComposeWorkspace('goal-2', tmpBase)
    await ws.ensure()
    vi.mocked(execFile).mockImplementation((_bin, _args, _opts, cb) => {
      (cb as any)(null, { stdout: 'LGTM', stderr: '' })
      return {} as any
    })
    await runReviewStage(ws)
    expect(await ws.exists('review.md')).toBe(true)
    const content = await ws.read('review.md')
    expect(content).toContain('LGTM')
  })
})
