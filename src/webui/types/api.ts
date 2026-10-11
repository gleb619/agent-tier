/**
 * DTOs matching what `at web` (src/web/server.ts) actually returns.
 * These are the wire shapes — keep in sync with src/run-store.ts (RunRecord),
 * src/notify/types.ts (NotifyEvent) and the server handlers.
 */

/** One run as served by GET /api/runs and GET /api/runs/:id (RunRecord + optional join scope). */
export interface ApiRun {
  runId: string;
  agent: string;
  tier: number;
  pid: number;
  prompt: string;
  logFile: string;
  startedAt: string;
  finishedAt: string | null;
  exitCode: number | null;
  status: "running" | "done" | "failed" | "stuck";
  name: string;
  /** Present when the run list joins several state dirs (project `.at/` + `~/.at/`). */
  scope?: string;
}

export interface ApiAgent {
  name: string;
  tier: number;
  promptMode: string;
  deactivated: boolean;
  failures: number;
  lastFailure: string | null;
  disabledTo: string | null;
}

export interface ApiStats {
  total: number;
  running: number;
  done: number;
  failed: number;
  stuck: number;
  agents: { total: number; deactivated: number };
}

export interface ApiRunLog {
  runId: string;
  lines: string[];
}

export interface CreateRunInput {
  prompt: string;
  agent?: string;
  tier?: number;
  cwd?: string;
}

/** GET/PUT /api/settings payload — an arbitrary JSON object (backend stores it verbatim). */
export type ApiSettings = Record<string, unknown>;

/** SSE event pushed by the hub via /api/events (src/notify/types.ts). */
export interface NotifyEvent {
  runId: string;
  agent: string;
  ts: string;
  seq: number;
  type: "start" | "message" | "tool" | "progress" | "error" | "done" | "question" | "answer" | "rename";
  text?: string;
  data?: Record<string, unknown>;
}
