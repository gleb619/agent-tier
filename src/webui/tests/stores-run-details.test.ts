import { get } from "svelte/store";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SSE_CLOSED, type SseSource } from "../api/sse";
import type { NotifyEvent } from "../types/api";
import { createRunDetailsSession, LOG_TAIL_LINES, MAX_LOG_LINES } from "../stores/run-details";
import { setRuns } from "../stores/runs";

interface FakeSource {
  listeners: Map<string, ((ev: { data: string; lastEventId: string }) => void)[]>;
  onopen: (() => void) | null;
  onerror: (() => void) | null;
  readyState: number;
  close(): void;
}

function makeSource(): FakeSource {
  const src: FakeSource = {
    listeners: new Map(),
    onopen: null,
    onerror: null,
    readyState: 1,
    close() {
      src.readyState = SSE_CLOSED;
    },
  };
  (src as unknown as { addEventListener: (t: string, cb: (ev: { data: string; lastEventId: string }) => void) => void })
    .addEventListener = (t, cb) => {
      src.listeners.set(t, [...(src.listeners.get(t) ?? []), cb]);
    };
  return src;
}

/** fetch mock for GET /api/runs/:id/log → tail of `logLines`. */
function stubLogFetch(logLines: string[]): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn(async (input: unknown) => {
    const url = String(input);
    const m = /^\/api\/runs\/([^/]+)\/log(?:\?lines=(\d+))?$/.exec(url);
    if (!m) return new Response(JSON.stringify({ error: "not found" }), { status: 404 });
    const n = Number(m[2] ?? LOG_TAIL_LINES);
    return new Response(JSON.stringify({ runId: m[1], lines: logLines.slice(-n) }), { status: 200 });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function dispatch(src: FakeSource, type: string, event: NotifyEvent): void {
  for (const cb of src.listeners.get(type) ?? []) {
    cb({ data: JSON.stringify(event), lastEventId: String(event.seq) });
  }
}

beforeEach(() => {
  setRuns([
    {
      runId: "r1",
      agent: "mm-code",
      tier: 2,
      pid: 1,
      prompt: "p",
      logFile: "/tmp/r1.log",
      startedAt: "2026-10-11T10:00:00.000Z",
      finishedAt: null,
      exitCode: null,
      status: "running",
      name: "UNNAMED",
    },
  ]);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("createRunDetailsSession", () => {
  it("refresh() loads the log tail as numbered lines", async () => {
    stubLogFetch(["a", "b", "c"]);
    const session = createRunDetailsSession("r1");
    await session.refresh();
    expect(get(session.lines)).toEqual([
      { n: 1, text: "a" },
      { n: 2, text: "b" },
      { n: 3, text: "c" },
    ]);
  });

  it("start() streams live events: text lines append, done re-syncs via refetch", async () => {
    const fetchMock = stubLogFetch(["seed"]);
    let src: FakeSource | null = null;
    const session = createRunDetailsSession("r1", {
      createSource: (() => {
        src = makeSource();
        return src as unknown as SseSource;
      }) as () => SseSource,
    });
    await session.refresh();
    session.start();
    (src as FakeSource | null)?.onopen?.();
    expect(get(session.connected)).toBe(true);

    dispatch(
      src!,
      "message",
      { runId: "r1", agent: "mm-code", ts: "t", seq: 1, type: "message", text: "live one\nlive two" },
    );
    expect(get(session.lines).map((l) => l.text)).toEqual(["seed", "live one", "live two"]);
    expect(get(session.lines).map((l) => l.n)).toEqual([1, 2, 3]);
    expect(get(session.lastEvent)?.type).toBe("message");

    const callsBefore = fetchMock.mock.calls.length;
    dispatch(src!, "done", { runId: "r1", agent: "mm-code", ts: "t", seq: 2, type: "done" });
    await vi.waitFor(() => expect(fetchMock.mock.calls.length).toBeGreaterThan(callsBefore));
    // Refetched tail replaces the buffer.
    await vi.waitFor(() => expect(get(session.lines)).toEqual([{ n: 1, text: "seed" }]));

    session.close();
    expect(get(session.connected)).toBe(false);
  });

  it("SSE status events still fold into the runs store", async () => {
    stubLogFetch([]);
    let src: FakeSource | null = null;
    const session = createRunDetailsSession("r1", {
      createSource: (() => {
        src = makeSource();
        return src as unknown as SseSource;
      }) as () => SseSource,
    });
    session.start();
    dispatch(src!, "error", { runId: "r1", agent: "mm-code", ts: "t", seq: 1, type: "error" });
    const { runs } = await import("../stores/runs");
    expect(get(runs)[0]?.status).toBe("failed");
    session.close();
  });

  it("caps the buffer at MAX_LOG_LINES and keeps numbering monotonic", async () => {
    stubLogFetch([]);
    const session = createRunDetailsSession("r1");
    await session.refresh();
    let src: FakeSource | null = null;
    const live = createRunDetailsSession("r1", {
      createSource: (() => {
        src = makeSource();
        return src as unknown as SseSource;
      }) as () => SseSource,
    });
    await live.refresh();
    live.start();
    for (let i = 0; i < MAX_LOG_LINES + 100; i++) {
      dispatch(src!, "message", {
        runId: "r1",
        agent: "mm-code",
        ts: "t",
        seq: i,
        type: "message",
        text: `line ${i}`,
      });
    }
    const buf = get(live.lines);
    expect(buf).toHaveLength(MAX_LOG_LINES);
    expect(buf[buf.length - 1]!.n).toBe(MAX_LOG_LINES + 100);
    expect(buf[0]!.text).toBe("line 100");
    live.close();
    session.close();
  });

  it("start() is a no-op without EventSource (non-browser) and close() is safe", () => {
    stubLogFetch([]);
    const session = createRunDetailsSession("r1");
    session.start(); // jsdom has no EventSource
    expect(get(session.connected)).toBe(false);
    session.close();
  });
});
