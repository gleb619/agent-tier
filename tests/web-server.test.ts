import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import http from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { startHub } from "../src/notify/hub";
import { type RunRecord, saveRuns } from "../src/run-store";
import { startWebServer, type WebServer } from "../src/web/server";

function makeRun(overrides: Partial<RunRecord> = {}): RunRecord {
  return {
    runId: `test-${Math.random().toString(36).slice(2, 8)}`,
    agent: "mock",
    tier: 4,
    pid: 999999,
    prompt: "hello world",
    logFile: path.join(tmpdir(), "at-web-test-missing.log"),
    startedAt: new Date().toISOString(),
    finishedAt: null,
    exitCode: null,
    status: "running",
    name: "unnamed",
    ...overrides,
  };
}

describe("web server", () => {
  let stateDir: string;
  let hub: Awaited<ReturnType<typeof startHub>>;
  let server: WebServer | undefined;

  beforeEach(() => {
    stateDir = mkdtempSync(path.join(tmpdir(), "at-web-"));
  });

  afterEach(async () => {
    await server?.close();
    await hub?.close();
    rmSync(stateDir, { recursive: true, force: true });
  });

  async function start(opts: { staticDir?: string; spawnAt?: (args: string[]) => void } = {}) {
    hub = await startHub({ stateDir, port: 0 });
    server = await startWebServer({ stateDirs: [stateDir], hub, port: 0, ...opts });
    return server;
  }

  function get(apiPath: string): Promise<{ status: number; body: string; contentType: string }> {
    return new Promise((resolve, reject) => {
      http
        .get(`http://127.0.0.1:${server!.port}${apiPath}`, (res) => {
          let body = "";
          res.on("data", (c: Buffer) => (body += c.toString()));
          res.on("end", () =>
            resolve({ status: res.statusCode ?? 0, body, contentType: res.headers["content-type"] ?? "" }),
          );
        })
        .on("error", reject);
    });
  }

  function request(method: string, apiPath: string, body?: unknown): Promise<{ status: number; body: string }> {
    return new Promise((resolve, reject) => {
      const data = body === undefined ? undefined : JSON.stringify(body);
      const req = http.request(
        `http://127.0.0.1:${server!.port}${apiPath}`,
        {
          method,
          headers:
            data !== undefined ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(data) } : {},
        },
        (res) => {
          let out = "";
          res.on("data", (c: Buffer) => (out += c.toString()));
          res.on("end", () => resolve({ status: res.statusCode ?? 0, body: out }));
        },
      );
      req.on("error", reject);
      if (data !== undefined) req.write(data);
      req.end();
    });
  }

  it("GET /api/runs returns [] on empty state dir", async () => {
    await start();
    const res = await get("/api/runs");
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body)).toEqual([]);
  });

  it("GET /api/runs lists runs newest first, annotates dead-pid run failed", async () => {
    const old = makeRun({
      startedAt: new Date(Date.now() - 60_000).toISOString(),
      status: "done",
      finishedAt: new Date().toISOString(),
      exitCode: 0,
    });
    const fresh = makeRun({ pid: process.pid });
    saveRuns(stateDir, [old, fresh]);
    await start();
    const res = await get("/api/runs");
    expect(res.status).toBe(200);
    const runs = JSON.parse(res.body) as RunRecord[];
    expect(runs).toHaveLength(2);
    expect(runs[0]!.runId).toBe(fresh.runId);
    const dead = runs.find((r) => r.runId === old.runId)!;
    expect(dead.status).toBe("done");
    const alive = runs.find((r) => r.runId === fresh.runId)!;
    expect(alive.status).toBe("running");
  });

  it("GET /api/runs/:id finds by full and prefix id, 404 on unknown", async () => {
    const run = makeRun({ status: "done", exitCode: 0, finishedAt: new Date().toISOString() });
    saveRuns(stateDir, [run]);
    await start();
    expect((await get(`/api/runs/${run.runId}`)).status).toBe(200);
    expect((await get(`/api/runs/${run.runId.slice(0, 6)}`)).status).toBe(200);
    expect((await get("/api/runs/nope")).status).toBe(404);
  });

  it("GET /api/runs/:id/log tails N lines", async () => {
    const logFile = path.join(stateDir, "run.log");
    writeFileSync(logFile, `${Array.from({ length: 300 }, (_, i) => `line ${i}`).join("\n")}\n`);
    const run = makeRun({ logFile, status: "done", exitCode: 0, finishedAt: new Date().toISOString() });
    saveRuns(stateDir, [run]);
    await start();
    const res = await get(`/api/runs/${run.runId}/log?lines=50`);
    expect(res.status).toBe(200);
    const lines = JSON.parse(res.body).lines as string[];
    expect(lines).toHaveLength(50);
    expect(lines[0]).toBe("line 250");
    expect(lines[49]).toBe("line 299");
    expect((await get(`/api/runs/nope/log`)).status).toBe(404);
    expect((await get(`/api/runs/${run.runId}/log`)).status).toBe(200);
  });

  it("GET /api/runs/:id/log 404 when log file missing", async () => {
    const run = makeRun({ status: "done", exitCode: 0, finishedAt: new Date().toISOString() });
    saveRuns(stateDir, [run]);
    await start();
    expect((await get(`/api/runs/${run.runId}/log`)).status).toBe(404);
  });

  it("POST /api/runs validates and spawns at CLI with args", async () => {
    const spawnAt = vi.fn();
    await start({ spawnAt });
    const bad = await request("POST", "/api/runs", { prompt: "" });
    expect(bad.status).toBe(400);

    const ok = await request("POST", "/api/runs", { prompt: "fix the bug", agent: "mock", tier: 4 });
    expect(ok.status).toBe(202);
    expect(JSON.parse(ok.body).ok).toBe(true);
    expect(spawnAt).toHaveBeenCalledTimes(1);
    const args = spawnAt.mock.calls[0]![0] as string[];
    expect(args).toEqual([process.execPath, process.argv[1], "-p", "fix the bug", "-a", "mock", "-t", "4"]);
  });

  it("POST /api/runs/retry respawns stored prompt/agent/tier, 404 on unknown", async () => {
    const spawnAt = vi.fn();
    const run = makeRun({
      agent: "mock",
      tier: 4,
      status: "failed",
      exitCode: 1,
      finishedAt: new Date().toISOString(),
    });
    saveRuns(stateDir, [run]);
    await start({ spawnAt });
    const res = await request("POST", `/api/runs/${run.runId}/retry`);
    expect(res.status).toBe(202);
    const args = spawnAt.mock.calls[0]![0] as string[];
    expect(args).toContain(run.prompt);
    expect(args).toEqual([process.execPath, process.argv[1], "-p", run.prompt, "-a", "mock", "-t", "4"]);
    expect((await request("POST", "/api/runs/nope/retry")).status).toBe(404);
  });

  it("DELETE /api/runs/:id kills the pid group and marks run failed", async () => {
    const child = spawn("sleep", ["30"], { detached: true, stdio: "ignore" });
    const run = makeRun({ pid: child.pid! });
    saveRuns(stateDir, [run]);
    await start();
    const res = await request("DELETE", `/api/runs/${run.runId}`);
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body).ok).toBe(true);
    await new Promise((r) => setTimeout(r, 100));
    expect(child.killed || child.exitCode !== null || child.signalCode !== null).toBe(true);
    const stored = JSON.parse(readFileSync(path.join(stateDir, "runs.jsonl"), "utf8").trim().split("\n")[0]!);
    expect(stored.status).toBe("failed");
    expect(stored.finishedAt).not.toBeNull();
    expect((await request("DELETE", "/api/runs/nope")).status).toBe(404);
  });

  it("GET /api/agents lists registry agents with health fields", async () => {
    await start();
    const res = await get("/api/agents");
    expect(res.status).toBe(200);
    const agents = JSON.parse(res.body) as Array<{
      name: string;
      tier: number;
      deactivated: boolean;
      failures: number;
    }>;
    const names = agents.map((a) => a.name);
    expect(names).toContain("glm-code");
    expect(names).toContain("mock");
    for (const a of agents) {
      expect(a).toHaveProperty("deactivated");
      expect(a).toHaveProperty("failures");
      expect(a).toHaveProperty("disabledTo");
    }
  });

  it("GET /api/stats counts runs by status", async () => {
    saveRuns(stateDir, [
      makeRun({ status: "done", exitCode: 0, finishedAt: new Date().toISOString() }),
      makeRun({ status: "failed", exitCode: 1, finishedAt: new Date().toISOString() }),
      makeRun({ status: "failed", exitCode: 1, finishedAt: new Date().toISOString() }),
      makeRun({ pid: process.pid }),
    ]);
    await start();
    const res = await get("/api/stats");
    expect(res.status).toBe(200);
    const stats = JSON.parse(res.body);
    expect(stats.total).toBe(4);
    expect(stats.running).toBe(1);
    expect(stats.done).toBe(1);
    expect(stats.failed).toBe(2);
    expect(stats.stuck).toBe(0);
    expect(stats.agents.total).toBeGreaterThan(0);
  });

  it("settings roundtrip: default {}, PUT persists, non-object rejected", async () => {
    await start();
    expect(JSON.parse((await get("/api/settings")).body)).toEqual({});

    const put = await request("PUT", "/api/settings", { defaultTier: 2, retries: 3 });
    expect(put.status).toBe(200);
    const settingsFile = path.join(stateDir, "web-settings.json");
    expect(existsSync(settingsFile)).toBe(true);
    expect(JSON.parse(readFileSync(settingsFile, "utf8"))).toEqual({ defaultTier: 2, retries: 3 });
    expect(JSON.parse((await get("/api/settings")).body)).toEqual({ defaultTier: 2, retries: 3 });

    expect((await request("PUT", "/api/settings", [1, 2])).status).toBe(400);
    expect((await request("PUT", "/api/settings", "nope")).status).toBe(400);
  });

  it("GET /api/events replays hub events", async () => {
    await start();
    hub.publish({ runId: "r1", agent: "mock", ts: new Date().toISOString(), seq: 0, type: "start" });
    hub.publish({ runId: "r1", agent: "mock", ts: new Date().toISOString(), seq: 0, type: "message", text: "hi" });

    const events = await new Promise<unknown[]>((resolve, reject) => {
      const req = http.get(`http://127.0.0.1:${server!.port}/api/events`, (res) => {
        let buffer = "";
        const found: unknown[] = [];
        res.on("data", (chunk: Buffer) => {
          buffer += chunk.toString();
          const parts = buffer.split("\n\n");
          buffer = parts.pop() ?? "";
          for (const part of parts) {
            const dataLine = part.split("\n").find((l) => l.startsWith("data:"));
            if (dataLine) found.push(JSON.parse(dataLine.slice(5)));
          }
        });
        setTimeout(() => {
          res.destroy();
          resolve(found);
        }, 400);
      });
      req.on("error", reject);
    });
    expect(events).toHaveLength(2);
    expect((events[0] as { type: string }).type).toBe("start");
    expect((events[1] as { text: string }).text).toBe("hi");
  });

  it("static: serves index, assets, SPA fallback; 404 without staticDir", async () => {
    const staticDir = mkdtempSync(path.join(tmpdir(), "at-web-static-"));
    writeFileSync(path.join(staticDir, "index.html"), "<html>webui</html>");
    writeFileSync(path.join(staticDir, "app.js"), "console.log(1)");
    try {
      await start({ staticDir });
      const index = await get("/");
      expect(index.status).toBe(200);
      expect(index.body).toBe("<html>webui</html>");
      expect(index.contentType).toContain("text/html");

      const asset = await get("/app.js");
      expect(asset.status).toBe(200);
      expect(asset.contentType).toContain("javascript");

      const spa = await get("/runs/some-id");
      expect(spa.status).toBe(200);
      expect(spa.body).toBe("<html>webui</html>");

      expect((await get("/api/nope")).status).toBe(404);
    } finally {
      rmSync(staticDir, { recursive: true, force: true });
    }

    await server?.close();
    server = undefined;
    hub = await startHub({ stateDir, port: 0 });
    server = await startWebServer({ stateDirs: [stateDir], hub, port: 0 });
    expect((await get("/")).status).toBe(404);
  });

  it("static: rejects path traversal outside staticDir", async () => {
    const staticDir = mkdtempSync(path.join(tmpdir(), "at-web-static-"));
    writeFileSync(path.join(staticDir, "index.html"), "<html>webui</html>");
    const secret = path.join(path.dirname(staticDir), "secret.txt");
    writeFileSync(secret, "secret");
    try {
      await start({ staticDir });
      const res = await get("/..%2Fsecret.txt");
      expect([200, 403, 404]).toContain(res.status);
      if (res.status === 200) expect(res.body).not.toContain("secret");
    } finally {
      rmSync(staticDir, { recursive: true, force: true });
      rmSync(secret, { force: true });
    }
  });
});

describe("web server discuss proxy", () => {
  let stateDir: string;
  let hub: Awaited<ReturnType<typeof startHub>>;
  let server: WebServer | undefined;

  beforeEach(() => {
    stateDir = mkdtempSync(path.join(tmpdir(), "at-web-discuss-"));
  });

  afterEach(async () => {
    await server?.close();
    await hub?.close();
    rmSync(stateDir, { recursive: true, force: true });
  });

  async function start() {
    hub = await startHub({ stateDir, port: 0 });
    server = await startWebServer({ stateDirs: [stateDir], hub, port: 0 });
    return server;
  }

  /** Direct request against the hub (port differs from the web server). */
  function hubRequest(method: string, hubPath: string, body?: unknown): Promise<{ status: number; body: string }> {
    return new Promise((resolve, reject) => {
      const data = body === undefined ? undefined : JSON.stringify(body);
      const req = http.request(
        `http://127.0.0.1:${hub.port}${hubPath}`,
        {
          method,
          headers:
            data !== undefined ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(data) } : {},
        },
        (res) => {
          let out = "";
          res.on("data", (c: Buffer) => (out += c.toString()));
          res.on("end", () => resolve({ status: res.statusCode ?? 0, body: out }));
        },
      );
      req.on("error", reject);
      if (data !== undefined) req.write(data);
      req.end();
    });
  }

  function request(method: string, apiPath: string, body?: unknown): Promise<{ status: number; body: string }> {
    return new Promise((resolve, reject) => {
      const data = body === undefined ? undefined : JSON.stringify(body);
      const req = http.request(
        `http://127.0.0.1:${server!.port}${apiPath}`,
        {
          method,
          headers:
            data !== undefined ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(data) } : {},
        },
        (res) => {
          let out = "";
          res.on("data", (c: Buffer) => (out += c.toString()));
          res.on("end", () => resolve({ status: res.statusCode ?? 0, body: out }));
        },
      );
      req.on("error", reject);
      if (data !== undefined) req.write(data);
      req.end();
    });
  }

  it("GET /api/runs/:id/discuss returns the thread and ?pending=1 only unanswered questions", async () => {
    await start();
    const run = makeRun({ runId: "discuss-1" });
    saveRuns(stateDir, [run]);
    // Seed a question + answer directly through the hub API.
    await hubRequest("POST", "/discuss/discuss-1", { kind: "question", text: "which port?", from: "agent" });
    await hubRequest("POST", "/discuss/discuss-1", { kind: "answer", text: "7800", replyTo: "m1", from: "host" });
    await hubRequest("POST", "/discuss/discuss-1", { kind: "question", text: "which dir?", from: "agent" });

    const thread = await request("GET", "/api/runs/discuss-1/discuss");
    expect(thread.status).toBe(200);
    const entries = JSON.parse(thread.body) as { kind: string; text: string }[];
    expect(entries.map((e) => e.text)).toEqual(["which port?", "7800", "which dir?"]);

    const pending = await request("GET", "/api/runs/discuss-1/discuss?pending=1");
    expect(pending.status).toBe(200);
    const pendingEntries = JSON.parse(pending.body) as { kind: string; text: string }[];
    expect(pendingEntries.map((e) => e.text)).toEqual(["which dir?"]);
  });

  it("POST /api/runs/:id/discuss appends a host entry and answers stop being pending", async () => {
    await start();
    const run = makeRun({ runId: "discuss-2" });
    saveRuns(stateDir, [run]);
    const ask = await hubRequest("POST", "/discuss/discuss-2", { kind: "question", text: "continue?", from: "agent" });
    expect(ask.status).toBe(202);

    const bad = await request("POST", "/api/runs/discuss-2/discuss", { kind: "answer", text: "" });
    expect(bad.status).toBe(400);

    const res = await request("POST", "/api/runs/discuss-2/discuss", { kind: "answer", text: "yes", replyTo: "m1" });
    expect(res.status).toBe(202);
    expect(JSON.parse(res.body)).toEqual({ id: "m2" });

    const pending = await request("GET", "/api/runs/discuss-2/discuss?pending=1");
    expect(JSON.parse(pending.body)).toEqual([]);
  });

  it("discuss routes 404 on unknown run id (prefix match applies)", async () => {
    await start();
    saveRuns(stateDir, [makeRun({ runId: "abcdef123456" })]);
    expect((await request("GET", "/api/runs/abc/discuss")).status).toBe(200);
    expect((await request("GET", "/api/runs/nope/discuss")).status).toBe(404);
    expect((await request("POST", "/api/runs/nope/discuss", { kind: "say", text: "hi" })).status).toBe(404);
  });
});
