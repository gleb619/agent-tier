/**
 * Decides whether a given prompt activates normka mode without needing
 * the caller to pass an explicit flag. Two prompt shapes are detected:
 *
 *   1. First non-blank line equals `#NORMKA` (case-insensitive).
 *   2. A ```json fenced block contains a `// normka:on` line.
 *
 * Used both by the at CLI (to forward `--normka` to tier-4 binaries
 * automatically) and by tests (to assert the helper).
 */
const HASH = /^\s*#NORMKA\s*$/im;
const FENCED = /```json[\s\S]*?\/\/\s*normka:on[\s\S]*?```/i;

export function shouldPassNormkaFlag(prompt: string): boolean {
  return HASH.test(prompt) || FENCED.test(prompt);
}

/**
 * Returns args with `--normka` appended iff the agent is tier 4 AND
 * the caller either set `normka: true` OR the prompt itself triggers
 * normka mode. Returns the args unchanged otherwise.
 */
import type { AgentDef } from './registry';

export function applyNormkaFlag(agent: AgentDef, args: string[], prompt: string, opts: { normka?: boolean } = {}): string[] {
  if (agent.tier !== 4) return args;
  if (!opts.normka && !shouldPassNormkaFlag(prompt)) return args;
  return [...args, '--normka'];
}
