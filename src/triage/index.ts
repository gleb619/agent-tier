import { decide, heuristicSignals, type TriageResult } from "./heuristic";
import { askTev1, refineSignals, type Tev1Options } from "./model";

export * from "./config";
export * from "./heuristic";
export * from "./model";

export interface TriageOptions {
  /**
   * Model providers, tried in order — first success wins (see `resolveTriageProviders`).
   * Empty/absent = heuristic only, which is instant.
   */
  models?: Tev1Options[];
}

/**
 * Heuristic verdict, optionally refined (veto-only) by the first reachable model. Every model
 * failure (down, hung, slow) degrades to the next provider, then to the heuristic verdict with
 * a `note`; this function never rejects.
 */
export async function triage(prompt: string, opts: TriageOptions = {}): Promise<TriageResult> {
  const base = heuristicSignals(prompt);
  // A task with no heuristic hit is the 90% case — skip the model call (and its latency) entirely.
  if (!opts.models?.length || base.length === 0) return decide(base, "heuristic");
  const notes: string[] = [];
  for (const model of opts.models) {
    try {
      const out = await askTev1(prompt, model);
      if (out.ok) {
        const source = `heuristic+${model.name ?? "model"}`;
        return decide(refineSignals(base, out.probs), source, notes.join("; ") || undefined);
      }
      notes.push(out.reason);
    } catch (err) {
      notes.push(`${model.name ?? "model"} error: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return decide(base, "heuristic", notes.join("; "));
}
