/**
 * Zero-cost triage heuristic: which delegation route fits a task prompt.
 * Default is ONE agent; two-agent compose is a candidate only with >= 2 complexity signals.
 */

export const SIGNALS = ["crossModule", "needsPlan", "iterative", "risky", "backlog"] as const;
export type Signal = (typeof SIGNALS)[number];

export type Route = "single" | "two-agents";

export interface TriageResult {
  route: Route;
  /** Suggested tier for `at -t`. */
  tier: 1 | 2;
  signals: Signal[];
  /** `heuristic`, or `heuristic+model` when a provider refined it. */
  source: string;
  /** Set when a model provider was requested but unusable (timeout, down, breaker open). */
  note?: string;
}

/** Signals needed before two-agent compose is even a candidate. */
export const TWO_AGENT_MIN_SIGNALS = 2;

const FILE_PATH = /(?:^|[\s`'"(])[\w.-]+(?:\/[\w.-]+)+\.\w{1,5}\b/g;

const PATTERNS: Record<Exclude<Signal, "crossModule">, RegExp> = {
  needsPlan:
    /\b(design|architect\w*|rfc|plan (it |this )?first|schema change|api change|breaking change|new subsystem)\b/i,
  iterative: /\b(until (the )?(tests? )?(pass|green)|iterate|fix[- ]test loop|keep (trying|fixing))\b/i,
  risky:
    /\b(migrat\w+|auth(entication|orization)?|security|concurren\w+|race condition|data loss|production|irreversible)\b/i,
  backlog: /\b(backlog|all (the )?tasks|each task|every task|kanban loop|drain)\b/i,
};

const CROSS_MODULE_WORDS =
  /\b(across (the )?(codebase|modules?|repo)|all modules|entire (repo|codebase)|monorepo|every (file|module))\b/i;
export const CROSS_MODULE_FILES = 6;

export function heuristicSignals(prompt: string): Signal[] {
  const out: Signal[] = [];
  const files = new Set((prompt.match(FILE_PATH) ?? []).map((m) => m.trim()));
  if (files.size >= CROSS_MODULE_FILES || CROSS_MODULE_WORDS.test(prompt)) out.push("crossModule");
  for (const [sig, re] of Object.entries(PATTERNS) as [Signal, RegExp][]) {
    if (re.test(prompt)) out.push(sig);
  }
  return out;
}

export function decide(signals: Signal[], source: string, note?: string): TriageResult {
  const route: Route = signals.length >= TWO_AGENT_MIN_SIGNALS ? "two-agents" : "single";
  const tier = signals.includes("risky") || signals.includes("needsPlan") ? 1 : 2;
  return { route, tier, signals, source, ...(note ? { note } : {}) };
}

export function heuristicTriage(prompt: string): TriageResult {
  return decide(heuristicSignals(prompt), "heuristic");
}
