import { mkdirSync, appendFileSync, readFileSync, existsSync } from 'fs';
import path from 'path';
import type { DiscussEntry } from './types';

export function getDiscussDir(stateDir: string): string {
  return path.join(stateDir, 'events');
}

export function getDiscussFilePath(stateDir: string, runId: string): string {
  return path.join(getDiscussDir(stateDir), `${runId}.discuss.jsonl`);
}

/** Append a single discuss entry as one JSONL line. */
export function appendDiscuss(stateDir: string, runId: string, entry: DiscussEntry): void {
  const dir = getDiscussDir(stateDir);
  mkdirSync(dir, { recursive: true });
  appendFileSync(getDiscussFilePath(stateDir, runId), JSON.stringify(entry) + '\n');
}

export function readThread(stateDir: string, runId: string): DiscussEntry[] {
  const file = getDiscussFilePath(stateDir, runId);
  if (!existsSync(file)) return [];
  const text = readFileSync(file, 'utf8');
  const lines = text.split('\n').filter((l) => l.trim());
  const out: DiscussEntry[] = [];
  for (const l of lines) {
    try {
      const obj = JSON.parse(l) as Record<string, unknown>;
      if (obj && typeof obj.id === 'string' && typeof obj.from === 'string' && typeof obj.kind === 'string') {
        out.push(obj as unknown as DiscussEntry);
      }
    } catch {
      // skip malformed line
    }
  }
  return out;
}

/** Compute next monotonic id "m1", "m2", ... based on existing entries. */
export function nextDiscussId(stateDir: string, runId: string): string {
  const entries = readThread(stateDir, runId);
  let max = 0;
  for (const e of entries) {
    const m = /^m(\d+)$/.exec(e.id);
    if (m) {
      const n = Number(m[1]);
      if (n > max) max = n;
    }
  }
  return `m${max + 1}`;
}

/** Find questions with no answer yet (no answer entry with replyTo === qid). */
export function unansweredQuestions(stateDir: string, runId: string): DiscussEntry[] {
  const entries = readThread(stateDir, runId);
  const answered = new Set<string>();
  for (const e of entries) {
    if (e.kind === 'answer' && e.replyTo) answered.add(e.replyTo);
  }
  return entries.filter((e) => e.kind === 'question' && !answered.has(e.id));
}

/** Return host `say` messages (optionally only those after `sinceId`). */
export function hostSays(stateDir: string, runId: string, sinceId?: string): DiscussEntry[] {
  const entries = readThread(stateDir, runId);
  const filtered = entries.filter((e) => e.kind === 'say' && e.from === 'host');
  if (!sinceId) return filtered;
  const idx = entries.findIndex((e) => e.id === sinceId);
  if (idx === -1) return filtered;
  const after = entries.slice(idx + 1);
  return after.filter((e) => e.kind === 'say' && e.from === 'host');
}

/** Find the most recent unanswered question (for `at discuss answer` w/o qid). */
export function latestUnansweredQuestion(stateDir: string, runId: string): DiscussEntry | undefined {
  const list = unansweredQuestions(stateDir, runId);
  return list[list.length - 1];
}

/** Poll for an answer whose replyTo === qid, up to timeoutMs. intervalMs between polls. */
export async function waitForAnswer(
  stateDir: string,
  runId: string,
  qid: string,
  timeoutMs: number,
  intervalMs = 200,
): Promise<DiscussEntry | undefined> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const entries = readThread(stateDir, runId);
    const ans = entries.find((e) => e.kind === 'answer' && e.replyTo === qid);
    if (ans) return ans;
    const remaining = deadline - Date.now();
    if (remaining <= 0) break;
    const sleep = Math.min(intervalMs, remaining);
    await new Promise((r) => setTimeout(r, sleep));
  }
  return undefined;
}