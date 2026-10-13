import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SSE_OPEN, type SseSource } from "../api/sse";
import { startGlobalEvents } from "../stores/sse";

/** Minimal EventSource double: manual dispatch of named events. */
class FakeSource implements SseSource {
  readyState = SSE_OPEN;
  onopen: ((ev: unknown) => void) | null = null;
  onerror: ((ev: unknown) => void) | null = null;
  private listeners = new Map<string, ((ev: MessageEvent) => void)[]>();
  close(): void {}
  addEventListener(type: string, cb: (ev: MessageEvent) => void): void {
    const arr = this.listeners.get(type) ?? [];
    arr.push(cb);
    this.listeners.set(type, arr);
  }
  dispatch(type: string, data: unknown): void {
    const ev = { data: JSON.stringify(data) } as MessageEvent;
    for (const cb of this.listeners.get(type) ?? []) cb(ev);
  }
}

function makeEvent(type: string, runId = "r1") {
  return { runId, agent: "mm-code", ts: "2026-10-11T10:00:00.000Z", seq: 1, type, text: "" };
}

describe("startGlobalEvents refetch debounce", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("coalesces a burst of refresh-triggering events into one refetch", () => {
    const refetch = vi.fn();
    const conn = startGlobalEvents(refetch, {
      createSource: () => new FakeSource(),
      pollIntervalMs: 0,
    });
    conn.connect();
    const source = (conn.manager as unknown as { source: FakeSource }).source;
    for (let i = 0; i < 5; i++) source.dispatch("start", makeEvent("start", `r${i}`));
    expect(refetch).not.toHaveBeenCalled();
    vi.advanceTimersByTime(200);
    expect(refetch).toHaveBeenCalledTimes(1);
    conn.close();
  });

  it("non-refresh events never refetch", () => {
    const refetch = vi.fn();
    const conn = startGlobalEvents(refetch, {
      createSource: () => new FakeSource(),
      pollIntervalMs: 0,
    });
    conn.connect();
    const source = (conn.manager as unknown as { source: FakeSource }).source;
    source.dispatch("progress", makeEvent("progress"));
    vi.advanceTimersByTime(500);
    expect(refetch).not.toHaveBeenCalled();
    conn.close();
  });

  it("close cancels a pending refetch", () => {
    const refetch = vi.fn();
    const conn = startGlobalEvents(refetch, {
      createSource: () => new FakeSource(),
      pollIntervalMs: 0,
    });
    conn.connect();
    const source = (conn.manager as unknown as { source: FakeSource }).source;
    source.dispatch("done", makeEvent("done"));
    conn.close();
    vi.advanceTimersByTime(500);
    expect(refetch).not.toHaveBeenCalled();
  });
});
