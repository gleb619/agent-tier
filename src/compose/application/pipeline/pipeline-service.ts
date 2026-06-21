import { runArchStage } from './arch-stage'
import { runDevStage } from './dev-stage'
import { runTestStage } from './test-stage'
import { runReviewStage } from './review-stage'
import type { ComposeWorkspace } from '../../infrastructure/workspace/compose-workspace'

export interface PipelineConfig {
  testCmd?: string
  maxNodes?: number
}

export class PipelineService {
  constructor(
    private readonly workspace: ComposeWorkspace,
    private readonly goalPrompt: string,
    private readonly config: PipelineConfig = {},
  ) {}

  async run(onDone?: () => void): Promise<void> {
    const failures: { stage: string; error: unknown }[] = []

    const tryRun = async (stage: string, fn: () => Promise<void>): Promise<void> => {
      try {
        await fn()
      } catch (err) {
        console.error(`[pipeline] ${stage} failed:`, err)
        failures.push({ stage, error: err })
      }
    }

    await tryRun('arch', () =>
      runArchStage({
        workspace: this.workspace,
        goalPrompt: this.goalPrompt,
        maxNodes: this.config.maxNodes,
      }),
    )
    await tryRun('dev', () => runDevStage(this.workspace))
    await tryRun('test', () => runTestStage(this.workspace, this.config.testCmd))
    await tryRun('review', () => runReviewStage(this.workspace))

    onDone?.()

    if (failures.length > 0) {
      const summary = failures.map(f => `${f.stage}: ${(f.error as Error)?.message ?? String(f.error)}`).join('; ')
      const error = new Error(`pipeline failed stages — ${summary}`)
      ;(error as Error & { failures: typeof failures }).failures = failures
      throw error
    }
  }
}