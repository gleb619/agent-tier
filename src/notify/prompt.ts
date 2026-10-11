import type { NotifyAdapterContext } from "./types";

/**
 * Shared instruction appended to every adapter's promptSuffix.
 *
 * Teaches the agent that it can both report milestones and ask the host for a
 * decision by shelling out — the runner exports AT_RUN_ID, AT_BIN, AT_SSE_URL,
 * AT_STATE_DIR so those CLIs resolve to the same `at` instance.
 */
export const DISCUSS_INSTRUCTION =
  '\n\nHost channel: if you need a decision, run `$AT_BIN discuss ask "<question>" -o <opt> -o <opt>` and use its stdout as the answer (blocks until answered). Post milestones with `$AT_BIN discuss note "<msg>"`. Check `$AT_BIN discuss inbox` for new host instructions at milestones.';

/**
 * Combine an adapter-specific suffix (may be empty) with the shared
 * discuss-instruction. Adapters should call this from their `promptSuffix(ctx)`
 * so the wording stays in one place.
 */
export function appendDiscussInstruction(existing: string): string {
  return existing ? `${existing}${DISCUSS_INSTRUCTION}` : DISCUSS_INSTRUCTION;
}

/**
 * Convenience for adapters: builds the suffix using the shared helper.
 * Pass `existing` to keep any adapter-specific instructions intact.
 */
export function buildPromptSuffix(_ctx: NotifyAdapterContext, existing = ""): string {
  return appendDiscussInstruction(existing);
}
