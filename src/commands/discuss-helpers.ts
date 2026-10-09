import type { DiscussEntry } from '../notify/types';
import {
  appendDiscuss,
  nextDiscussId,
} from '../notify/discuss-store';
import { resolveStateDir } from '../state-dir';

export interface PostResult {
  id: string;
}

/**
 * Append a discuss entry to the per-run thread, or POST to the hub if
 * AT_SSE_URL is set. Mirrors `at discuss note`/`say`/`answer`/`ask` first-step.
 */
export async function postDiscussEntry(
  runId: string,
  entry: Omit<DiscussEntry, 'id' | 'ts'>,
  stateDir?: string,
): Promise<string> {
  const sseUrl = process.env.AT_SSE_URL;
  if (sseUrl) {
    const url = `${sseUrl.replace(/\/$/, '')}/discuss/${encodeURIComponent(runId)}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(entry),
    });
    if (!res.ok) {
      console.error(`[at] discuss: hub POST failed: ${res.status} ${await res.text()}`);
      process.exit(1);
    }
    const json = (await res.json()) as PostResult;
    return json.id;
  }
  const resolved = stateDir ?? resolveStateDir(process.env.AT_STATE_DIR);
  const id = nextDiscussId(resolved, runId);
  const full: DiscussEntry = { ...entry, id, ts: new Date().toISOString() };
  appendDiscuss(resolved, runId, full);
  return id;
}
