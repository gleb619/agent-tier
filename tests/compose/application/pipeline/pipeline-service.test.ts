import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm } from 'fs/promises'
import os from 'os'
import path from 'path'
import { ComposeWorkspace } from '../../../../src/compose/infrastructure/workspace/compose-workspace'

vi.mock('../../../../src/compose/application/pipeline/arch-stage', () => ({
  runArchStage: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('../../../../src/compose/application/pipeline/dev-stage', () => ({
  runDevStage: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('../../../../src/compose/application/pipeline/test-stage', () => ({
  runTestStage: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('../../../../src/compose/application/pipeline/review-stage', () => ({
  runReviewStage: vi.fn().mockResolvedValue(undefined),
}))

import { PipelineService } from '../../../../src/compose/application/pipeline/pipeline-service'
import { runArchStage } from '../../../../src/compose/application/pipeline/arch-stage'
import { runDevStage } from '../../../../src/compose/application/pipeline/dev-stage'
import { runTestStage } from '../../../../src/compose/application/pipeline/test-stage'
import { runReviewStage } from '../../../../src/compose/application/pipeline/review-stage'

let tmpBase: string

beforeEach(async () => {
  tmpBase = await mkdtemp(path.join(os.tmpdir(), 'pipeline-svc-'))
  vi.clearAllMocks()
})
afterEach(async () => {
  await rm(tmpBase, { recursive: true, force: true })
})

describe('PipelineService.run', () => {
  it('calls all 4 stages in order and invokes onDone', async () => {
    const ws = new ComposeWorkspace('g1', tmpBase)
    const svc = new PipelineService(ws, 'build auth', { testCmd: 'npm test' })
    const onDone = vi.fn()
    await svc.run(onDone)
    expect(runArchStage).toHaveBeenCalledOnce()
    expect(runDevStage).toHaveBeenCalledOnce()
    expect(runTestStage).toHaveBeenCalledOnce()
    expect(runReviewStage).toHaveBeenCalledOnce()
    expect(onDone).toHaveBeenCalledOnce()
  })

  it('works without onDone callback', async () => {
    const ws = new ComposeWorkspace('g2', tmpBase)
    const svc = new PipelineService(ws, 'build feature')
    await expect(svc.run()).resolves.toBeUndefined()
  })
})