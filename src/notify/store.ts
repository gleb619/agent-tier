import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import type { NotifyEvent } from "./types";

export function getEventsDir(stateDir: string): string {
  return path.join(stateDir, "events");
}

export function getEventFilePath(stateDir: string, runId: string): string {
  return path.join(getEventsDir(stateDir), `${runId}.jsonl`);
}

export function appendEvent(stateDir: string, event: NotifyEvent): void {
  const dir = getEventsDir(stateDir);
  mkdirSync(dir, { recursive: true });
  appendFileSync(getEventFilePath(stateDir, event.runId), `${JSON.stringify(event)}\n`);
}

export function readEvents(stateDir: string, runId: string): NotifyEvent[] {
  const file = getEventFilePath(stateDir, runId);
  if (!existsSync(file)) return [];
  const text = readFileSync(file, "utf8");
  const lines = text.split("\n").filter((l) => l.trim());
  return lines.map((l) => JSON.parse(l) as NotifyEvent);
}

export function readEventsSince(stateDir: string, runId: string, sinceSeq: number): NotifyEvent[] {
  return readEvents(stateDir, runId).filter((e) => e.seq > sinceSeq);
}

/** Read every stored event under a state dir, excluding discuss files. */
export function readAllEvents(stateDir: string): NotifyEvent[] {
  const dir = getEventsDir(stateDir);
  if (!existsSync(dir)) return [];
  const out: NotifyEvent[] = [];
  for (const entry of readdirSync(dir)) {
    if (!entry.endsWith(".jsonl") || entry.endsWith(".discuss.jsonl")) continue;
    const runId = entry.slice(0, -".jsonl".length);
    out.push(...readEvents(stateDir, runId));
  }
  return out;
}
