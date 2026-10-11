import type { ApiRun } from "$types/api";

/** Searchable fields of a run (name + prompt + runId), matched as one haystack. */
export type SearchableRun = Pick<ApiRun, "name" | "prompt" | "runId">;

/**
 * Case-insensitive, multi-token AND match over name/prompt/runId.
 * Every whitespace-separated token must appear somewhere in the haystack.
 */
export function matchesQuery(run: SearchableRun, query: string): boolean {
  const tokens = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return true;
  const haystack = `${run.name}\n${run.prompt}\n${run.runId}`.toLowerCase();
  return tokens.every((token) => haystack.includes(token));
}
