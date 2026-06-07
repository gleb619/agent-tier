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
    await runArchStage({
      workspace: this.workspace,
      goalPrompt: this.goalPrompt,
      maxNodes: this.config.maxNodes,
    })
    await runDevStage(this.workspace)
    await runTestStage(this.workspace, this.config.testCmd)
    await runReviewStage(this.workspace)
    onDone?.()
  }
}