import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import { ApiClient, ApiError } from "../api/client";
import type { ApiRun } from "../types/api";

const RUN: ApiRun = {
  runId: "r1",
  agent: "mm-code",
  tier: 2,
  pid: 123,
  prompt: "fix the bug",
  logFile: "/tmp/r1.log",
  startedAt: "2026-10-11T10:00:00.000Z",
  finishedAt: null,
  exitCode: null,
  status: "running",
  name: "UNNAMED",
};

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

/** Fetch mock that records calls and answers from a queue/handler. */
function mockFetch(handler: (url: string, init?: RequestInit) => Response) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const impl = vi.fn(async (url: string | URL, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    return handler(String(url), init);
  });
  return { impl: impl as unknown as typeof fetch, calls };
}

describe("ApiClient", () => {
  beforeEach(() => {});

  it("getRuns GETs /api/runs and parses the list", async () => {
    const { impl, calls } = mockFetch(() => jsonResponse(200, [RUN]));
    const client = new ApiClient("", impl);
    await expect(client.getRuns()).resolves.toEqual([RUN]);
    expect(calls[0]?.url).toBe("/api/runs");
    expect(calls[0]?.init?.method ?? "GET").toBe("GET"); // default GET
  });

  it("getRun encodes the run id", async () => {
    const { impl, calls } = mockFetch(() => jsonResponse(200, RUN));
    const client = new ApiClient("", impl);
    await expect(client.getRun("a/b c")).resolves.toEqual(RUN);
    expect(calls[0]?.url).toBe("/api/runs/a%2Fb%20c");
  });

  it("getRunLog passes the lines param", async () => {
    const { impl, calls } = mockFetch(() => jsonResponse(200, { runId: "r1", lines: ["a", "b"] }));
    const client = new ApiClient("", impl);
    await expect(client.getRunLog("r1", 50)).resolves.toEqual({ runId: "r1", lines: ["a", "b"] });
    expect(calls[0]?.url).toBe("/api/runs/r1/log?lines=50");
  });

  it("getRunLog omits the lines param when not given", async () => {
    const { impl, calls } = mockFetch(() => jsonResponse(200, { runId: "r1", lines: [] }));
    const client = new ApiClient("", impl);
    await client.getRunLog("r1");
    expect(calls[0]?.url).toBe("/api/runs/r1/log");
  });

  it("createRun POSTs JSON prompt/agent/tier and accepts 202", async () => {
    const { impl, calls } = mockFetch(() => jsonResponse(202, { ok: true }));
    const client = new ApiClient("", impl);
    await expect(client.createRun({ prompt: "do it", agent: "mm-code", tier: 2 })).resolves.toEqual({ ok: true });
    expect(calls[0]?.url).toBe("/api/runs");
    expect(calls[0]?.init?.method).toBe("POST");
    expect(calls[0]?.init?.headers).toEqual({ "Content-Type": "application/json" });
    expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({ prompt: "do it", agent: "mm-code", tier: 2 });
  });

  it("retryRun POSTs to /api/runs/:id/retry", async () => {
    const { impl, calls } = mockFetch(() => jsonResponse(202, { ok: true }));
    const client = new ApiClient("", impl);
    await expect(client.retryRun("r1")).resolves.toEqual({ ok: true });
    expect(calls[0]?.url).toBe("/api/runs/r1/retry");
    expect(calls[0]?.init?.method).toBe("POST");
  });

  it("deleteRun DELETEs and adds force=1 when asked", async () => {
    const { impl, calls } = mockFetch(() => jsonResponse(200, { ok: true }));
    const client = new ApiClient("", impl);
    await client.deleteRun("r1", { force: true });
    expect(calls[0]?.url).toBe("/api/runs/r1?force=1");
    expect(calls[0]?.init?.method).toBe("DELETE");
    await client.deleteRun("r1");
    expect(calls[1]?.url).toBe("/api/runs/r1");
  });

  it("getAgents and getStats parse their payloads", async () => {
    const agents = [{ name: "mm-code", tier: 2, promptMode: "pipe", deactivated: false, failures: 0, lastFailure: null, disabledTo: null }];
    const stats = { total: 1, running: 1, done: 0, failed: 0, stuck: 0, agents: { total: 14, deactivated: 0 } };
    const { impl, calls } = mockFetch((url) => (url === "/api/agents" ? jsonResponse(200, agents) : jsonResponse(200, stats)));
    const client = new ApiClient("", impl);
    await expect(client.getAgents()).resolves.toEqual(agents);
    await expect(client.getStats()).resolves.toEqual(stats);
    expect(calls.map((c) => c.url)).toEqual(["/api/agents", "/api/stats"]);
  });

  it("getSettings GETs and putSettings PUTs the JSON object", async () => {
    const settings = { defaultTier: 2 };
    const { impl, calls } = mockFetch((url, init) => {
      if (init?.method === "PUT") return jsonResponse(200, settings);
      return jsonResponse(200, settings);
    });
    const client = new ApiClient("", impl);
    await expect(client.getSettings()).resolves.toEqual(settings);
    await expect(client.putSettings(settings)).resolves.toEqual(settings);
    expect(calls[0]?.url).toBe("/api/settings");
    expect(calls[1]?.init?.method).toBe("PUT");
    expect(JSON.parse(String(calls[1]?.init?.body))).toEqual(settings);
  });

  it("throws ApiError with status + server message on non-OK", async () => {
    const { impl } = mockFetch(() => jsonResponse(404, { error: "run not found" }));
    const client = new ApiClient("", impl);
    const err = await client.getRun("nope").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(404);
    expect((err as ApiError).message).toBe("run not found");
  });

  it("falls back to the status text when the body has no error field", async () => {
    const { impl } = mockFetch(() => new Response("nope", { status: 500 }));
    const client = new ApiClient("", impl);
    const err = await client.getRuns().catch((e: unknown) => e);
    expect((err as ApiError).status).toBe(500);
    expect((err as ApiError).message).toContain("500");
  });

  it("prefixes baseUrl when set", async () => {
    const { impl, calls } = mockFetch(() => jsonResponse(200, []));
    const client = new ApiClient("http://127.0.0.1:7800", impl);
    await client.getRuns();
    expect(calls[0]?.url).toBe("http://127.0.0.1:7800/api/runs");
  });
});

describe("settings/runs api wrappers", () => {
  let fetchSpy: MockInstance;

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("wrappers hit the default client endpoints", async () => {
    fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse(200, [RUN]));
    const { listRuns } = await import("../api/runs");
    await expect(listRuns()).resolves.toEqual([RUN]);
    expect(fetchSpy).toHaveBeenCalledWith("/api/runs", expect.anything());
  });
});
