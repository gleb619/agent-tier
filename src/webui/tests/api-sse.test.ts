import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NotifyEvent } from "../types/api";
import { SseManager, SSE_CLOSED, SSE_CONNECTING, SSE_OPEN, type SseSource } from "../api/sse";

/** Minimal EventSource double: manual dispatch, controllable readyState. */
class FakeSource implements SseSource {
  static instances: FakeSource[] = [];
  readyState = SSE_CONNECTING;
  onopen: ((ev: unknown) => void) | null = null;
  onerror: ((ev: unknown) => void) | null = null;
  onmessage: ((ev: MessageEvent) => void) | null = null;
  listeners = new Map<string, ((ev: MessageEvent) => void)[]>();
  closed = false;
  readonly url: string;

  constructor(url: string) {
    this.url = url;
    FakeSource.instances.push(this);
  }

  addEventListener(type: string, cb: (ev: MessageEvent) => void): void {
    const arr = this.listeners.get(type) ?? [];
    arr.push(cb);
    this.listeners.set(type, arr);
  }

  close(): void {
    this.closed = true;
    this.readyState = SSE_CLOSED;
  }

  dispatch(type: string, data: unknown, lastEventId = ""): void {
    const ev = { data: JSON.stringify(data), lastEventId } as MessageEvent;
    for (const cb of this.listeners.get(type) ?? []) cb(ev);
  }

  open(): void {
    this.readyState = SSE_OPEN;
    this.onopen?.(null);
  }

  fail(closed: boolean): void {
    if (closed) this.readyState = SSE_CLOSED;
    this.onerror?.(null);
  }
}

function lastInstance(): FakeSource {
  return FakeSource.instances[FakeSource.instances.length - 1] as FakeSource;
}

const EVT: NotifyEvent = { runId: "r1", agent: "mm-code", ts: "2026-10-11T10:00:00.000Z", seq: 3, type: "progress", text: "hi" };

describe("SseManager", () => {
  beforeEach(() => {
    FakeSource.instances = [];
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("connect() opens a source and subscribes the known event types", () => {
    const m = new SseManager({ url: "/api/events", createSource: (u) => new FakeSource(u), onEvent: () => {} });
    m.connect();
    const src = lastInstance();
    expect(src.url).toBe("/api/events");
    for (const t of ["start", "message", "tool", "progress", "question", "answer", "error", "done"]) {
      expect(src.listeners.get(t)?.length).toBe(1);
    }
  });

  it("dispatches parsed NotifyEvents to onEvent", () => {
    const seen: NotifyEvent[] = [];
    const m = new SseManager({ url: "/api/events", createSource: (u) => new FakeSource(u), onEvent: (e) => seen.push(e) });
    m.connect();
    lastInstance().dispatch("progress", EVT, "3");
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ runId: "r1", type: "progress", seq: 3 });
    expect(m.lastEventId).toBe("3");
  });

  it("reports connected on open, disconnected on error", () => {
    const statuses: boolean[] = [];
    const m = new SseManager({ url: "/api/events", createSource: (u) => new FakeSource(u), onEvent: () => {}, onStatus: (ok) => statuses.push(ok) });
    m.connect();
    lastInstance().open();
    expect(statuses).toEqual([true]);
    lastInstance().fail(false);
    expect(statuses).toEqual([true, false]);
  });

  it("reconnects with backoff when the source gives up (CLOSED)", async () => {
    const m = new SseManager({
      url: "/api/events",
      createSource: (u) => new FakeSource(u),
      onEvent: () => {},
      baseDelayMs: 100,
      maxDelayMs: 800,
    });
    m.connect();
    lastInstance().fail(true); // CLOSED → browser will NOT auto-reconnect
    await vi.advanceTimersByTimeAsync(99);
    expect(FakeSource.instances).toHaveLength(1); // not yet
    await vi.advanceTimersByTimeAsync(1);
    expect(FakeSource.instances).toHaveLength(2); // reconnected after 100ms
  });

  it("grows the delay exponentially and caps it", async () => {
    const m = new SseManager({
      url: "/api/events",
      createSource: (u) => new FakeSource(u),
      onEvent: () => {},
      baseDelayMs: 100,
      maxDelayMs: 300,
    });
    m.connect();
    // attempt 1 → 100ms
    lastInstance().fail(true);
    await vi.advanceTimersByTimeAsync(100);
    // attempt 2 → 200ms
    lastInstance().fail(true);
    await vi.advanceTimersByTimeAsync(199);
    expect(FakeSource.instances).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(FakeSource.instances).toHaveLength(3);
    // attempt 3 → capped at 300ms
    lastInstance().fail(true);
    await vi.advanceTimersByTimeAsync(299);
    expect(FakeSource.instances).toHaveLength(3);
    await vi.advanceTimersByTimeAsync(1);
    expect(FakeSource.instances).toHaveLength(4);
  });

  it("resets the backoff after a successful open", async () => {
    const m = new SseManager({
      url: "/api/events",
      createSource: (u) => new FakeSource(u),
      onEvent: () => {},
      baseDelayMs: 100,
    });
    m.connect();
    lastInstance().fail(true);
    await vi.advanceTimersByTimeAsync(100);
    lastInstance().open(); // healthy again
    lastInstance().fail(true); // next failure starts back at base delay
    await vi.advanceTimersByTimeAsync(100);
    expect(FakeSource.instances).toHaveLength(3);
  });

  it("falls back to polling after maxRetries failed attempts", async () => {
    const poll = vi.fn(async () => {});
    const m = new SseManager({
      url: "/api/events",
      createSource: (u) => new FakeSource(u),
      onEvent: () => {},
      baseDelayMs: 10,
      maxRetries: 2,
      pollIntervalMs: 100,
      poll,
    });
    m.connect();
    lastInstance().fail(true);
    await vi.advanceTimersByTimeAsync(10); // retry 1 (delay 10)
    lastInstance().fail(true);
    await vi.advanceTimersByTimeAsync(20); // retry 2 (delay 20)
    lastInstance().fail(true); // 3rd failure with maxRetries=2 → poll mode
    await vi.advanceTimersByTimeAsync(100);
    expect(poll).toHaveBeenCalled();
  });

  it("stops polling and resets once reconnected", async () => {
    const poll = vi.fn(async () => {});
    const m = new SseManager({
      url: "/api/events",
      createSource: (u) => new FakeSource(u),
      onEvent: () => {},
      baseDelayMs: 10,
      maxRetries: 0, // poll immediately after the first failure
      pollIntervalMs: 100,
      poll,
    });
    m.connect();
    lastInstance().fail(true);
    await vi.advanceTimersByTimeAsync(250); // ~2-3 polls while down
    lastInstance().open(); // back online
    const countAtOpen = poll.mock.calls.length;
    await vi.advanceTimersByTimeAsync(500);
    expect(poll.mock.calls.length).toBe(countAtOpen); // no more polls
  });

  it("close() tears everything down and never reconnects", async () => {
    const m = new SseManager({ url: "/api/events", createSource: (u) => new FakeSource(u), onEvent: () => {}, baseDelayMs: 10 });
    m.connect();
    const src = lastInstance();
    m.close();
    expect(src.closed).toBe(true);
    src.fail(true); // late error after close
    await vi.advanceTimersByTimeAsync(10_000);
    expect(FakeSource.instances).toHaveLength(1);
  });

  it("connect() is idempotent while connected", () => {
    const m = new SseManager({ url: "/api/events", createSource: (u) => new FakeSource(u), onEvent: () => {} });
    m.connect();
    m.connect();
    expect(FakeSource.instances).toHaveLength(1);
  });
});
