import { get } from "svelte/store";
import { afterEach, beforeEach, describe, expect, it, type MockInstance, vi } from "vitest";

/** Tiny localStorage double (tests run in node env). */
function stubLocalStorage(): Map<string, string> {
  const map = new Map<string, string>();
  const store = {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, String(v)),
    removeItem: (k: string) => void map.delete(k),
    clear: () => void map.clear(),
  };
  vi.stubGlobal("localStorage", store);
  return map;
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

describe("settings store", () => {
  let fetchSpy: MockInstance;

  beforeEach(() => {
    stubLocalStorage();
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("starts with defaults", async () => {
    const { settings, DEFAULT_SETTINGS } = await import("../stores/settings");
    expect(get(settings)).toEqual(DEFAULT_SETTINGS);
  });

  it("load merges backend settings over defaults", async () => {
    fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse(200, { defaultTier: 3, theme: "dark" }));
    const { settings, loadSettings } = await import("../stores/settings");
    await loadSettings();
    expect(get(settings).defaultTier).toBe(3);
    expect(get(settings).theme).toBe("dark");
    expect(get(settings).autoRefresh).toBe(true); // untouched default survives
    expect(fetchSpy).toHaveBeenCalledWith("/api/settings", expect.anything());
  });

  it("load keeps defaults when the backend errors", async () => {
    fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse(500, { error: "boom" }));
    const { settings, loadSettings, DEFAULT_SETTINGS } = await import("../stores/settings");
    await expect(loadSettings()).resolves.toBeUndefined(); // swallows, never throws
    expect(get(settings)).toEqual(DEFAULT_SETTINGS);
  });

  it("save PUTs the merged settings and reflects the response", async () => {
    fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(jsonResponse(200, { defaultTier: 2, defaultAgent: "pi" }));
    const { settings, saveSettings } = await import("../stores/settings");
    await saveSettings({ defaultAgent: "pi" });
    const call = fetchSpy.mock.calls[0];
    const init = call?.[1] as RequestInit;
    expect(call?.[0]).toBe("/api/settings");
    expect(init.method).toBe("PUT");
    expect(JSON.parse(String(init.body))).toMatchObject({ defaultTier: 2, defaultAgent: "pi" });
    expect(get(settings).defaultAgent).toBe("pi");
  });
});

describe("ui store", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("defaults: dashboard view, sidebar open, focus off", async () => {
    stubLocalStorage();
    const { currentView, sidebarOpen, focusMode } = await import("../stores/ui");
    expect(get(currentView)).toBe("dashboard");
    expect(get(sidebarOpen)).toBe(true);
    expect(get(focusMode)).toBe(false);
  });

  it("restores persisted prefs from localStorage", async () => {
    const map = stubLocalStorage();
    map.set("webui.sidebarOpen", "false");
    map.set("webui.currentView", '"settings"');
    const { currentView, sidebarOpen } = await import("../stores/ui");
    expect(get(sidebarOpen)).toBe(false);
    expect(get(currentView)).toBe("settings");
  });

  it("persists changes back to localStorage", async () => {
    const map = stubLocalStorage();
    const { setCurrentView, sidebarOpen } = await import("../stores/ui");
    setCurrentView("new-task");
    sidebarOpen.set(false);
    expect(map.get("webui.currentView")).toBe('"new-task"');
    expect(map.get("webui.sidebarOpen")).toBe("false");
  });

  it("ignores invalid persisted view values", async () => {
    const map = stubLocalStorage();
    map.set("webui.currentView", "hax");
    const { currentView } = await import("../stores/ui");
    expect(get(currentView)).toBe("dashboard");
  });

  it("works without localStorage (no crash)", async () => {
    // no stub → localStorage undefined in node
    const mod = await import("../stores/ui");
    expect(() => mod.setCurrentView("settings")).not.toThrow();
    expect(get(mod.currentView)).toBe("settings");
  });
});

describe("filters store", () => {
  beforeEach(async () => {
    vi.resetModules();
    const { runs } = await import("../stores/runs");
    runs.set([]);
  });

  it("filteredRuns passes everything by default", async () => {
    const { runs } = await import("../stores/runs");
    const { filteredRuns } = await import("../stores/filters");
    const mk = (runId: string): Parameters<typeof runs.set>[0][number] => ({
      runId,
      agent: "mm-code",
      tier: 2,
      pid: 1,
      prompt: "p",
      logFile: `/tmp/${runId}.log`,
      startedAt: "2026-10-11T10:00:00.000Z",
      finishedAt: null,
      exitCode: null,
      status: "running",
      name: "UNNAMED",
    });
    runs.set([mk("a"), mk("b")]);
    expect(get(filteredRuns)).toHaveLength(2);
  });

  it("filters by status, agent and search text", async () => {
    const { runs } = await import("../stores/runs");
    const { filteredRuns, statusFilter, agentFilter, searchQuery } = await import("../stores/filters");
    const mk = (runId: string, status: "running" | "done" | "failed", agent: string, prompt: string, name: string) => ({
      runId,
      agent,
      tier: 2,
      pid: 1,
      prompt,
      logFile: `/tmp/${runId}.log`,
      startedAt: "2026-10-11T10:00:00.000Z",
      finishedAt: null,
      exitCode: null,
      status,
      name,
    });
    runs.set([
      mk("r1", "running", "mm-code", "fix the login bug", "UNNAMED"),
      mk("r2", "done", "pi", "write docs", "docs-session"),
      mk("r3", "failed", "mm-code", "write docs", "UNNAMED"),
    ]);

    statusFilter.set("done");
    expect(get(filteredRuns).map((r) => r.runId)).toEqual(["r2"]);
    statusFilter.set("all");

    agentFilter.set("pi");
    expect(get(filteredRuns).map((r) => r.runId)).toEqual(["r2"]);
    agentFilter.set("all");

    searchQuery.set("DOCS");
    expect(
      get(filteredRuns)
        .map((r) => r.runId)
        .sort(),
    ).toEqual(["r2", "r3"]);
    searchQuery.set("login");
    expect(get(filteredRuns).map((r) => r.runId)).toEqual(["r1"]);
  });
});

describe("sse stores + glue", () => {
  /** Minimal EventSource double wired through createSseConnection's options. */
  let lastSource: {
    listeners: Map<string, ((ev: { data: string; lastEventId: string }) => void)[]>;
    onopen: (() => void) | null;
    onerror: (() => void) | null;
    readyState: number;
  } | null = null;

  beforeEach(() => {
    vi.resetModules();
    lastSource = null;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("createSseConnection drives sseConnected/lastEventTime/connectionError and the runs store", async () => {
    stubLocalStorage();
    const { SSE_CLOSED } = await import("../api/sse");
    const { sseConnected, lastEventTime, connectionError, createSseConnection } = await import("../stores/sse");
    const { runs } = await import("../stores/runs");
    runs.set([
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

    const conn = createSseConnection("/api/events", {
      createSource: () => {
        const src = {
          listeners: new Map<string, ((ev: { data: string; lastEventId: string }) => void)[]>(),
          onopen: null as (() => void) | null,
          onerror: null as (() => void) | null,
          readyState: 1,
        };
        // minimal SseSource surface the manager uses
        (
          src as unknown as {
            addEventListener: (t: string, cb: (ev: { data: string; lastEventId: string }) => void) => void;
          }
        ).addEventListener = (t, cb) => {
          src.listeners.set(t, [...(src.listeners.get(t) ?? []), cb]);
        };
        (src as unknown as { close: () => void }).close = () => {
          src.readyState = SSE_CLOSED;
        };
        lastSource = src;
        return src as unknown as import("../api/sse").SseSource;
      },
    });

    conn.connect();

    lastSource?.onopen?.();
    expect(get(sseConnected)).toBe(true);

    const dispatch = (type: string, data: unknown, id: string) => {
      for (const cb of lastSource?.listeners.get(type) ?? []) cb({ data: JSON.stringify(data), lastEventId: id });
    };
    dispatch("done", { runId: "r1", agent: "mm-code", ts: "t", seq: 1, type: "done" }, "1");
    expect(get(lastEventTime)).not.toBeNull();
    expect(get(runs)[0]?.status).toBe("done");

    lastSource?.onerror?.();
    expect(get(sseConnected)).toBe(false);

    conn.close();
  });

  it("connectionError carries the message from onStatus", async () => {
    stubLocalStorage();
    const { connectionError, createSseConnection } = await import("../stores/sse");
    const conn = createSseConnection("/api/events", {
      createSource: () => ({ readyState: 2, onopen: null, onerror: null, addEventListener: () => {}, close: () => {} }),
    });
    conn.fail("hub down");
    expect(get(connectionError)).toBe("hub down");
    conn.close();
    expect(get(connectionError)).toBeNull();
  });

  it("startGlobalEvents refetches on status-bearing events only and folds events into the runs store", async () => {
    stubLocalStorage();
    vi.useFakeTimers();
    try {
      const { SSE_CLOSED } = await import("../api/sse");
      const { startGlobalEvents } = await import("../stores/sse");
      const { runs } = await import("../stores/runs");

      const listeners = new Map<string, ((ev: { data: string; lastEventId: string }) => void)[]>();
      let refetches = 0;
      const conn = startGlobalEvents(
        () => {
          refetches += 1;
        },
        {
          createSource: () => {
            const src = {
              listeners,
              onopen: null as (() => void) | null,
              onerror: null as (() => void) | null,
              readyState: 1,
              addEventListener: (t: string, cb: (ev: { data: string; lastEventId: string }) => void) => {
                listeners.set(t, [...(listeners.get(t) ?? []), cb]);
              },
              close: () => {
                src.readyState = SSE_CLOSED;
              },
            };
            return src as unknown as import("../api/sse").SseSource;
          },
        },
      );
      conn.connect();

      const dispatch = (type: string, data: unknown) => {
        for (const cb of listeners.get(type) ?? []) cb({ data: JSON.stringify(data), lastEventId: "" });
      };
      const event = (type: string) => ({ runId: "r1", agent: "mock", ts: "t", seq: 1, type }) as const;

      dispatch("message", event("message"));
      vi.advanceTimersByTime(200);
      expect(refetches).toBe(0);

      // Refetches are debounced (100ms trailing): advance past the window.
      dispatch("start", event("start"));
      vi.advanceTimersByTime(200);
      expect(refetches).toBe(1);

      dispatch("done", event("done"));
      vi.advanceTimersByTime(200);
      expect(refetches).toBe(2);

      dispatch("rename", event("rename"));
      vi.advanceTimersByTime(200);
      expect(refetches).toBe(3);

      // Status folding still applies (base glue runs before the refetch hook).
      runs.set([
        {
          runId: "r1",
          agent: "mock",
          tier: 4,
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
      dispatch("done", { runId: "r1", agent: "mock", ts: "t", seq: 2, type: "done" });
      expect(get(runs)[0]?.status).toBe("done");

      conn.close();
    } finally {
      vi.useRealTimers();
    }
  });
});
