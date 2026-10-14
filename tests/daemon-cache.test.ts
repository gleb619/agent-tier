/**
 * T35 — hot-cache read-through layer. A real unix-socket fake stands in for
 * `atd` so the transport (src/daemon-client) and the typed readers
 * (src/daemon-cache) are exercised end to end, including the fallbacks that
 * keep the CLI working when the daemon is absent or wrong.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import net from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// `buildStateReport` falls back to `loadConfig` whenever the cache has no
// config answer. Pin that fallback to "no config" so the suite tests the
// read-through logic instead of whatever ~/.at/config.json holds on this box.
vi.mock("../src/config", async (importObject) => {
  const actual = await importObject<typeof import("../src/config")>();
  return { ...actual, loadConfig: () => null };
});

import { formatCacheReport } from "../src/commands/daemon";
import { computeHmac } from "../src/config";
import {
  agentBinCandidates,
  cachedBinResolution,
  cachedConfig,
  cachedHealth,
  cachedRuns,
  cachedState,
  cacheStats,
  type DaemonCacheStats,
  readCache,
} from "../src/daemon-cache";
import { daemonSockPath } from "../src/daemon-client";
import { pickAgent } from "../src/scheduler";
import { buildStatusSnapshot } from "../src/status";

interface FakeDaemon {
  requests: Array<Record<string, unknown>>;
  stop(): Promise<void>;
}

/** Serve one JSON response per request line; `reply` may return nothing to hang. */
async function startFakeDaemon(reply: (req: Record<string, unknown>) => unknown): Promise<FakeDaemon> {
  const sock = daemonSockPath();
  const requests: Array<Record<string, unknown>> = [];
  const server = net.createServer((conn) => {
    conn.on("data", (chunk) => {
      const req = JSON.parse(chunk.toString().trim().split("\n")[0]) as Record<string, unknown>;
      requests.push(req);
      const resp = reply(req);
      if (resp !== undefined) conn.write(`${JSON.stringify(resp)}\n`);
      conn.end();
    });
  });
  await new Promise<void>((resolve) => server.listen(sock, resolve));
  return {
    requests,
    stop: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections?.();
        server.close(() => resolve());
      }),
  };
}

function ok(data: unknown, cached = false): Record<string, unknown> {
  return { ok: true, data, cached, version: "0.1.0" };
}

let stateDir = "";
let daemon: FakeDaemon | null = null;
const origEnv = {
  AT_STATE_DIR: process.env.AT_STATE_DIR,
  AT_NO_DAEMON: process.env.AT_NO_DAEMON,
  AT_DEPTH: process.env.AT_DEPTH,
  AT_CONFIG_DIR: process.env.AT_CONFIG_DIR,
};

beforeEach(() => {
  stateDir = mkdtempSync(path.join(tmpdir(), "at-daemon-cache-"));
  process.env.AT_STATE_DIR = stateDir;
  delete process.env.AT_NO_DAEMON;
  delete process.env.AT_DEPTH;
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(async () => {
  await daemon?.stop();
  daemon = null;
  vi.restoreAllMocks();
  rmSync(stateDir, { recursive: true, force: true });
  for (const [k, v] of Object.entries(origEnv)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

describe("readCache transport", () => {
  it("returns the daemon payload and its cache flag", async () => {
    daemon = await startFakeDaemon((req) => (req.cmd === "runs" ? ok([{ runId: "r1" }], true) : undefined));
    const res = await readCache<unknown[]>("runs", { dir: "/somewhere/.at" });
    expect(res).toEqual({ data: [{ runId: "r1" }], cached: true });
    expect(daemon.requests[0]).toMatchObject({ cmd: "runs", dir: "/somewhere/.at", version: "0.1.0" });
  });

  it("passes kind params through as top-level request fields", async () => {
    daemon = await startFakeDaemon(() => ok({}));
    await readCache("bins", { extra: { candidates: { kimi: ["/usr/local/bin/kimi"] } } });
    expect(daemon.requests[0]).toMatchObject({ cmd: "bins", candidates: { kimi: ["/usr/local/bin/kimi"] } });
  });

  it("returns null when the daemon is disabled", async () => {
    process.env.AT_NO_DAEMON = "1";
    expect(await readCache("runs")).toBeNull();
  });

  it("returns null when no daemon socket exists", async () => {
    expect(await readCache("runs")).toBeNull();
  });

  it("returns null on an error response", async () => {
    daemon = await startFakeDaemon(() => ({ ok: false, error: "parse runs.jsonl: bad json" }));
    expect(await readCache("runs")).toBeNull();
  });

  it("returns null on a malformed response", async () => {
    const server = net.createServer((conn) => conn.on("data", () => conn.end("nonsense")));
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(daemonSockPath(), resolve);
    });
    try {
      expect(await readCache("runs")).toBeNull();
    } finally {
      server.closeAllConnections?.();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it("returns null when the daemon accepts but never answers", async () => {
    daemon = await startFakeDaemon(() => undefined);
    await expect(readCache("runs", { timeoutMs: 200 })).resolves.toBeNull();
  }, 10_000);

  it("returns null when the response carries no data field", async () => {
    daemon = await startFakeDaemon(() => ({ ok: true, cached: true }));
    expect(await readCache("state")).toBeNull();
  });
});

describe("typed cache readers", () => {
  it("cachedRuns accepts only array payloads", async () => {
    daemon = await startFakeDaemon(() => ok([{ runId: "a", status: "done" }]));
    expect(await cachedRuns(stateDir)).toEqual([{ runId: "a", status: "done" }]);
    await daemon.stop();
    daemon = await startFakeDaemon(() => ok({ nope: true }));
    expect(await cachedRuns(stateDir)).toBeNull();
  });

  it("cachedState and cachedHealth mirror the TS store shapes", async () => {
    daemon = await startFakeDaemon((req) =>
      req.cmd === "health"
        ? ok({ agents: { qwen: { failureTimes: [], disabledTo: null } } })
        : ok({ scheduler: { line: { index: 4 } } }),
    );
    expect(await cachedState(stateDir)).toEqual({ scheduler: { line: { index: 4 } } });
    expect(await cachedHealth(stateDir)).toEqual({ agents: { qwen: { failureTimes: [], disabledTo: null } } });
  });

  it("cachedHealth rejects a payload without an agents map", async () => {
    daemon = await startFakeDaemon(() => ok({ scheduler: {} }));
    expect(await cachedHealth(stateDir)).toBeNull();
  });

  it("cachedConfig verifies the HMAC over socket bytes instead of trusting the daemon", async () => {
    const text = JSON.stringify({ line: ["kimi"] });
    daemon = await startFakeDaemon(() => ok({ text, hmac: computeHmac(text) }));
    expect(await cachedConfig({ quiet: true })).toEqual({ line: ["kimi"] });
  });

  it("cachedConfig returns null when the cached bytes are tampered", async () => {
    daemon = await startFakeDaemon(() => ok({ text: JSON.stringify({ line: ["kimi"] }), hmac: "deadbeef" }));
    expect(await cachedConfig({ quiet: true })).toBeNull();
    expect(console.error).not.toHaveBeenCalled();
    // Non-quiet must still report the tampering — the cache path must not
    // silence the integrity warning loadConfig emits.
    expect(await cachedConfig()).toBeNull();
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("HMAC mismatch"));
  });

  it("cachedConfig returns undefined when there is nothing cached to verify", async () => {
    daemon = await startFakeDaemon(() => ok({ text: "", hmac: "" }));
    expect(await cachedConfig({ quiet: true })).toBeUndefined();
    await daemon.stop();
    expect(await cachedConfig({ quiet: true })).toBeUndefined(); // no daemon
  });

  it("cachedBinResolution keeps unresolved names as null", async () => {
    daemon = await startFakeDaemon(() => ok({ glm: "/usr/local/bin/glm-code", devin: null }));
    expect(await cachedBinResolution({ glm: ["/usr/local/bin/glm-code"], devin: ["/nope/devin"] })).toEqual({
      glm: "/usr/local/bin/glm-code",
      devin: null,
    });
  });

  it("cacheStats returns the daemon counters", async () => {
    daemon = await startFakeDaemon(() => ok({ hits: 3, misses: 1, invalidations: 2, entries: 4, watched: [stateDir] }));
    expect(await cacheStats()).toEqual({ hits: 3, misses: 1, invalidations: 2, entries: 4, watched: [stateDir] });
  });

  it("agentBinCandidates resolves one entry per registered agent", () => {
    const cands = agentBinCandidates();
    expect(Object.keys(cands).length).toBeGreaterThan(0);
    for (const [name, paths] of Object.entries(cands)) {
      expect(typeof name).toBe("string");
      expect(Array.isArray(paths)).toBe(true);
      expect(paths.length).toBeGreaterThan(0);
    }
  });
});

describe("scheduler reads state.json through the daemon", () => {
  const agents = ["a", "b", "c"].map((name) => ({
    name,
    tier: 2 as const,
    bin: () => `/usr/bin/${name}`,
    buildArgs: (p: string) => [p],
  }));

  it("picks after the daemon-reported index and persists the advance", async () => {
    const stateFile = path.join(stateDir, "state.json");
    writeFileSync(stateFile, JSON.stringify({ scheduler: { default: { index: 0 } } }), "utf8");
    daemon = await startFakeDaemon((req) =>
      req.cmd === "state" ? ok({ scheduler: { default: { index: 1 } } }) : undefined,
    );

    expect((await pickAgent(agents, stateFile)).name).toBe("c");
    expect(JSON.parse(readFileSync(stateFile, "utf8")).scheduler.default.index).toBe(2);
  });

  it("reads the file directly when the daemon is disabled", async () => {
    const stateFile = path.join(stateDir, "state.json");
    writeFileSync(stateFile, JSON.stringify({ scheduler: { default: { index: 1 } } }), "utf8");
    process.env.AT_NO_DAEMON = "1";
    expect((await pickAgent(agents, stateFile)).name).toBe("c");
  });

  it("reads the file directly when the cache read fails", async () => {
    const stateFile = path.join(stateDir, "state.json");
    writeFileSync(stateFile, JSON.stringify({ scheduler: { default: { index: 1 } } }), "utf8");
    daemon = await startFakeDaemon(() => ({ ok: false, error: "hot caches unavailable" }));
    expect((await pickAgent(agents, stateFile)).name).toBe("c");
  });
});

describe("at status reads state through the daemon", () => {
  function seedDisk(index: number): void {
    writeFileSync(
      path.join(stateDir, "runs.jsonl"),
      `${JSON.stringify({ runId: "r1", agent: "kimi", status: "done", startedAt: new Date().toISOString() })}\n`,
      "utf8",
    );
    writeFileSync(path.join(stateDir, "state.json"), JSON.stringify({ scheduler: { line: { index } } }), "utf8");
  }

  it("uses daemon-reported scheduler state instead of re-reading the file", async () => {
    seedDisk(0);
    daemon = await startFakeDaemon((req) => {
      if (req.cmd === "state") return ok({ scheduler: { line: { index: 2 } }, agents: {} });
      if (req.cmd === "health") return ok({ agents: {} });
      if (req.cmd === "config") return ok({ text: "", hmac: "" });
      return ok(null);
    });
    const report = await buildStatusSnapshot([stateDir]);
    const lineEntry = report.state?.scheduler.find((e) => e.key === "line");
    expect(lineEntry?.index).toBe(2);
    expect(daemon.requests.map((r) => r.cmd)).toContain("state");
  });

  it("uses daemon-reported config for the line queue", async () => {
    seedDisk(0);
    const text = JSON.stringify({ line: ["qwen"] });
    daemon = await startFakeDaemon((req) => {
      if (req.cmd === "state") return ok({ scheduler: { line: { index: 0 } }, agents: {} });
      if (req.cmd === "health") return ok({ agents: {} });
      if (req.cmd === "config") return ok({ text, hmac: computeHmac(text) });
      return ok(null);
    });
    const report = await buildStatusSnapshot([stateDir]);
    expect(report.state?.scheduler.find((e) => e.key === "line")?.agentName).toBe("qwen");
  });

  it("falls back to direct reads when the daemon is not there", async () => {
    seedDisk(1);
    process.env.AT_NO_DAEMON = "1";
    const report = await buildStatusSnapshot([stateDir]);
    expect(report.state?.scheduler.find((e) => e.key === "line")?.index).toBe(1);
    expect(report.total).toBe(1);
  });

  it("still refreshes runs from disk (writes stay outside the cache)", async () => {
    seedDisk(0);
    daemon = await startFakeDaemon((req) => {
      if (req.cmd === "runs") return ok([{ runId: "from-cache", agent: "kimi", status: "running", pid: 1 }]);
      if (req.cmd === "state") return ok({ scheduler: {}, agents: {} });
      if (req.cmd === "health") return ok({ agents: {} });
      return ok({ text: "", hmac: "" });
    });
    const report = await buildStatusSnapshot([stateDir]);
    expect(report.runs.map((r) => r.runId)).toEqual(["r1"]);
  });
});

describe("at daemon cache report", () => {
  const stats: DaemonCacheStats = { hits: 3, misses: 1, invalidations: 2, entries: 5, watched: ["/home/x/.at"] };

  it("says so when the daemon did not answer", () => {
    expect(formatCacheReport(null, null)).toContain("daemon not running");
  });

  it("renders counters, watched paths, and missing bins", () => {
    const out = formatCacheReport(stats, { kimi: "/usr/local/bin/kimi", devin: null });
    expect(out).toContain("hits: 3  misses: 1  invalidations: 2  entries: 5");
    expect(out).toContain("/home/x/.at");
    expect(out).toMatch(/^\s*kimi\s+\/usr\/local\/bin\/kimi$/m);
    expect(out).toMatch(/^\s*devin\s+<missing>$/m);
  });

  it("flags an absent watched set instead of an empty list", () => {
    expect(formatCacheReport({ ...stats, watched: [] }, {})).toContain("watched: (none)");
  });

  it("separates no-bin-data from all-missing", () => {
    expect(formatCacheReport(stats, null)).toContain("not serving bin resolution");
    expect(formatCacheReport(stats, {})).not.toContain("not serving bin resolution");
  });
});
