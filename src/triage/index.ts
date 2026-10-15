import { decide, heuristicSignals, type TriageResult } from "./heuristic";
import { askTev1, refineSignals, type Tev1Options } from "./model";

export * from "./heuristic";
export * from "./model";

export interface TriageOptions {
  /** Refine with a model provider (see `resolveModelConfig`). Off by default; the heuristic alone is instant. */
  model?: Tev1Options;
}

/**
 * Heuristic verdict, optionally refined by tev1. tev1 failure (down, hung, slow) degrades to
 * the heuristic verdict with a `note`; this function never rejects.
 */
export async function triage(prompt: string, opts: TriageOptions = {}): Promise<TriageResult> {
  const base = heuristicSignals(prompt);
  if (!opts.model) return decide(base, "heuristic");
  // A task with no heuristic hit is the 90% case — skip the model call (and its latency) entirely.
  if (base.length === 0) return decide(base, "heuristic");
  try {
    const out = await askTev1(prompt, opts.model);
    if (!out.ok) return decide(base, "heuristic", out.reason);
    return decide(refineSignals(base, out.probs), "heuristic+model");
  } catch (err) {
    return decide(base, "heuristic", `model error: ${err instanceof Error ? err.message : String(err)}`);
  }
}
