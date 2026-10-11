import { type Readable, writable } from "svelte/store";
import type { NotifyEvent } from "$types/api";
import { type LogLine, toLogLines } from "$utils/log";
import { getRunLog } from "../api/runs";
import type { SseSource } from "../api/sse";
import { applySseEvent } from "./runs";
import { connectionError, createSseConnection, type SseConnection, sseConnected } from "./sse";

/** Initial tail fetched from GET /api/runs/:id/log on refresh. */
export const LOG_TAIL_LINES = 500;
/** Buffer cap; older lines are dropped once the buffer grows past this. */
export const MAX_LOG_LINES = 5000;

export interface RunDetailsSessionOptions {
  /** Inject a fake EventSource factory (tests). Forwarded to the SSE manager. */
  createSource?: (url: string) => SseSource;
}

export interface RunDetailsSession {
  readonly runId: string;
  /** Buffered log lines: initial tail + live SSE appends, numbered 1-based. */
  readonly lines: Readable<LogLine[]>;
  /** Last SSE event seen on this run's stream (null before the first one). */
  readonly lastEvent: Readable<NotifyEvent | null>;
  /** Whether the per-run SSE stream is currently connected. */
  readonly connected: Readable<boolean>;
  /** Refetch the log tail from the API, replacing the buffer. */
  refresh(): Promise<void>;
  /** Open the per-run SSE stream (no-op in non-browser envs unless a source factory is injected). */
  start(): void;
  close(): void;
}

/**
 * Live session for the run-details view: log buffer fed by an initial REST
 * tail plus per-run SSE appends. Status-bearing events still fold into the
 * shared runs store via applySseEvent; `done`/`error` trigger a final refetch
 * so the buffer converges with the on-disk log.
 */
export function createRunDetailsSession(runId: string, options: RunDetailsSessionOptions = {}): RunDetailsSession {
  const lines = writable<LogLine[]>([]);
  const lastEvent = writable<NotifyEvent | null>(null);
  const connected = writable(false);
  let conn: SseConnection | null = null;
  let nextLineNo = 1;

  async function refresh(): Promise<void> {
    const log = await getRunLog(runId, LOG_TAIL_LINES);
    const next = toLogLines(log.lines);
    nextLineNo = next.length + 1;
    lines.set(next);
  }

  function appendText(text: string | undefined): void {
    if (!text) return;
    const parts = text.split("\n");
    const start = nextLineNo;
    nextLineNo += parts.length;
    lines.update((cur) => {
      const kept = cur.length + parts.length > MAX_LOG_LINES ? cur.slice(-(MAX_LOG_LINES - parts.length)) : cur;
      return [...kept, ...toLogLines(parts, start)];
    });
  }

  function onEvent(event: NotifyEvent): void {
    lastEvent.set(event);
    applySseEvent(event);
    if (event.type === "message" || event.type === "tool" || event.type === "progress" || event.type === "error") {
      appendText(event.text);
    }
    if (event.type === "done" || event.type === "error") {
      void refresh().catch(() => {});
    }
  }

  function onStatus(isConnected: boolean, error?: string): void {
    connected.set(isConnected);
    sseConnected.set(isConnected);
    connectionError.set(isConnected ? null : (error ?? null));
  }

  function start(): void {
    if (conn) return;
    if (typeof EventSource === "undefined" && !options.createSource) return;
    conn = createSseConnection(`/api/events/${encodeURIComponent(runId)}`, { onEvent, onStatus, ...options });
    conn.connect();
  }

  function close(): void {
    conn?.close();
    conn = null;
    connected.set(false);
  }

  return { runId, lines, lastEvent, connected, refresh, start, close };
}
