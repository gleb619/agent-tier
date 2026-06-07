import { describe, it, expect, vi } from 'vitest'
vi.mock('child_process', async (importOriginal) => {
  const orig = await importOriginal()
  return { ...orig, execFile: vi.fn() }
})
import { getCodegraphContext } from '../../src/commands/codegraph'
import { execFile } from 'child_process'

describe('getCodegraphContext', () => {
  it('returns stdout on success', async () => {
    vi.mocked(execFile).mockImplementation((_bin, _args, cb: any) => { cb(null, { stdout: '## Context', stderr: '' }); return {} as any })
    const result = await getCodegraphContext('add auth', 20)
    expect(result).toBe('## Context')
  })
  it('returns fallback on error', async () => {
    vi.mocked(execFile).mockImplementation((_bin, _args, cb: any) => { cb(new Error('not found'), { stdout: '', stderr: '' }); return {} as any })
    const result = await getCodegraphContext('add auth')
    expect(result).toContain('[codegraph context unavailable')
  })
})
