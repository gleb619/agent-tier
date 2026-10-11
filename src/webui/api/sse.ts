import type { NotifyEvent } from "$types/api";

/** readyState values of the DOM EventSource API. */
export const SSE_CONNECTING = 0;
export const SSE_OPEN = 1;
export const SSE_CLOSED = 2;

/** Minimal surface of the DOM EventSource the manager relies on (injectable for tests). */
export interface SseSource {
  readonly readyState: number;
  onopen: ((ev: unknown) => void) | null;
  onerror: ((ev: unknown) => void) | null;
  addEventListener(type: string, cb: (ev: MessageEvent) => void): void;
  close(): void;
}

export interface SseManagerOptions {
  /** URL of the SSE stream (`/api/events` or `/api/events/:runId`). */
  url: string;
  /** Parsed hub events (src/notify/types.ts NotifyEvent). */
  onEvent: (event: NotifyEvent) => void;
  /** Connection state changes; `error` is a human-readable reason when known. */
  onStatus?: (connected: boolean, error?: string) => void;
  /** Source factory; defaults to the DOM EventSource. Inject a fake in tests. */
  createSource?: (url: string) => SseSource;
  /** Reconnect backoff base (first retry delay). Default 1000ms. */
  baseDelayMs?: number;
  /** Reconnect backoff cap. Default 30000ms. */
  maxDelayMs?: number;
  /** Failed reconnect attempts before switching to the polling fallback. Default 5. */
  maxRetries?: number;
  /** Poll interval for the fallback; 0 disables the fallback. Default 10000ms. */
  pollIntervalMs?: number;
  /**
   * Fallback action polled when SSE stays down — typically a `listRuns()`
   * refresh so the UI keeps moving without the stream.
   */
  poll?: () => Promise<void>;
}

/** Event types the hub emits; each is subscribed as a named SSE event. */
const EVENT_TYPES = ["start", "message", "tool", "progress", "question", "answer", "error", "done", "rename"] as const;

/**
 * EventSource wrapper with exponential-backoff reconnect and a polling fallback.
 *
 * While the browser's own auto-reconnect is pending (readyState CONNECTING) the
 * native `Last-Event-ID` resume applies. Only when the browser gives up
 * (readyState CLOSED) does this manager reconnect manually with backoff — a
 * fresh EventSource cannot replay a custom Last-Event-ID header, so the poll
 * fallback covers any gap.
 */
export class SseManager {
  /** Last seen SSE event id (from MessageEvent.lastEventId), for diagnostics. */
  lastEventId = "";

  private readonly opts: Required<Pick<SseManagerOptions, "url" | "onEvent" | "baseDelayMs" | "maxDelayMs" | "maxRetries" | "pollIntervalMs">> &
    SseManagerOptions;
  private source: SseSource | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private retries = 0;
  private closedByUser = false;

  constructor(options: SseManagerOptions) {
    this.opts = {
      baseDelayMs: 1000,
      maxDelayMs: 30000,
      maxRetries: 5,
      pollIntervalMs: 10000,
      ...options,
    };
  }

  connect(): void {
    if (this.source) return;
    this.closedByUser = false;
    this.openSource();
  }

  /** Tear down source, timers and fallback for good. */
  close(): void {
    this.closedByUser = true;
    this.clearTimers();
    this.source?.close();
    this.source = null;
    this.setStatus(false);
  }

  private openSource(): void {
    const create = this.opts.createSource ?? ((url: string) => new EventSource(url) as unknown as SseSource);
    const src = create(this.opts.url);
    this.source = src;

    src.onopen = () => {
      this.retries = 0;
      this.stopPolling();
      this.setStatus(true);
    };
    src.onerror = () => {
      this.setStatus(false, src.readyState === SSE_CLOSED ? "connection lost" : "reconnecting");
      if (this.closedByUser) return;
      if (src.readyState === SSE_CLOSED) this.scheduleReconnect();
    };
    for (const type of EVENT_TYPES) {
      src.addEventListener(type, (ev: MessageEvent) => {
        if (ev.lastEventId) this.lastEventId = ev.lastEventId;
        try {
          this.opts.onEvent(JSON.parse(ev.data) as NotifyEvent);
        } catch {}
      });
    }
  }

  private scheduleReconnect(): void {
    if (this.opts.pollIntervalMs > 0 && this.retries >= this.opts.maxRetries) this.startPolling();
    const delay = Math.min(this.opts.baseDelayMs * 2 ** this.retries, this.opts.maxDelayMs);
    this.retries += 1;
    this.source?.close();
    this.source = null;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      if (!this.closedByUser) this.openSource();
    }, delay);
  }

  private startPolling(): void {
    if (this.pollTimer || !this.opts.poll) return;
    void this.opts.poll().catch(() => {});
    this.pollTimer = setInterval(() => {
      void this.opts.poll?.().catch(() => {});
    }, this.opts.pollIntervalMs);
  }

  private stopPolling(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  private clearTimers(): void {
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
    this.stopPolling();
  }

  private setStatus(connected: boolean, error?: string): void {
    this.opts.onStatus?.(connected, error);
  }
}
