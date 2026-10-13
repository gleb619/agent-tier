// Shared WebUI REST contract: the same cases run against ANY backend that
// claims backend parity (web-server/internal/api) — the Go at-web server
// (tests/web-server.test.ts) and the Go at-web binary
// (tests/web-server-go.test.ts). Each wrapper provides start()/spawnedArgs();
// everything else (fixtures, requests, assertions) lives here.
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import http from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type RunRecord, saveRuns } from "../src/run-store";

export interface ContractTarget {
  baseUrl: string;
  close(): Promise<void>;
}

export interface ContractHooks {
  /** Boot a backend rooted at stateDir. */
  start(stateDir: string): Promise<ContractTarget>;
  /** Argv of every detached `at` CLI spawn since boot (POST /api/runs, retry). */
  spawnedArgs(target: ContractTarget): Promise<string[][]>;
}

export function makeRun(overrides: Partial<RunRecord> = {}): RunRecord {
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

/** Poll until `pid` is gone or a zombie (`kill(pid, 0)` succeeds for reaped
 *  or unreaped-but-dead children alike; /proc state disambiguates). */
async function expectPidDead(pid: number): Promise<void> {
  const deadline = Date.now() + 3000;
  while (Date.now() < deadline) {
    try {
      process.kill(pid, 0);
    } catch {
      return; // ESRCH: gone
    }
    try {
      const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
      if (stat.split(" ")[7] === "Z") return; // zombie: dead, just unreaped
    } catch {
      return; // /proc entry gone
    }
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error(`pid ${pid} still alive`);
}

/** Detached `sleep 30`; returns its pid (a process-group leader). */
export function spawnSleep(): number {
  const child = spawn("sleep", ["30"], { detached: true, stdio: "ignore" });
  child.once("error", () => {});
  child.unref();
  if (!child.pid) throw new Error("sleep spawn failed");
  return child.pid;
}

export function describeWebApiContract(name: string, hooks: ContractHooks): void {
  describe(name, () => {
    let stateDir: string;
    let target: ContractTarget | undefined;

    beforeEach(() => {
      stateDir = mkdtempSync(path.join(tmpdir(), "at-web-contract-"));
    });

    afterEach(async () => {
      await target?.close();
      target = undefined;
      rmSync(stateDir, { recursive: true, force: true });
    });

    async function start(): Promise<ContractTarget> {
      target = await hooks.start(stateDir);
      return target;
    }

    function get(apiPath: string): Promise<{ status: number; body: string; contentType: string }> {
      return new Promise((resolve, reject) => {
        http
          .get(`${target!.baseUrl}${apiPath}`, (res) => {
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
          `${target!.baseUrl}${apiPath}`,
          {
            method,
            headers:
              data !== undefined
                ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(data) }
                : {},
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
      expect(runs.find((r) => r.runId === old.runId)!.status).toBe("done");
      expect(runs.find((r) => r.runId === fresh.runId)!.status).toBe("running");
    });

    it("GET /api/runs/:id finds by full and prefix id, 404 on unknown", async () => {
      const run = makeRun({ status: "done", exitCode: 0, finishedAt: new Date().toISOString() });
      saveRuns(stateDir, [run]);
      await start();
      expect((await get(`/api/runs/${run.runId}`)).status).toBe(200);
      expect((await get(`/api/runs/${run.runId.slice(0, 6)}`)).status).toBe(200);
      expect((await get("/api/runs/nope")).status).toBe(404);
    });

    it("GET /api/runs/:id/log tails N lines, 404 on unknown run or missing log", async () => {
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

      const noLog = makeRun({ status: "done", exitCode: 0, finishedAt: new Date().toISOString() });
      saveRuns(stateDir, [noLog]);
      expect((await get(`/api/runs/${noLog.runId}/log`)).status).toBe(404);
    });

    it("POST /api/runs validates the body", async () => {
      await start();
      expect((await request("POST", "/api/runs", { prompt: "" })).status).toBe(400);
      expect((await request("POST", "/api/runs", { agent: "mock" })).status).toBe(400);
      expect((await request("POST", "/api/runs", { prompt: "x", agent: 3 })).status).toBe(400);
      expect((await request("POST", "/api/runs", { prompt: "x", tier: 5 })).status).toBe(400);
      expect((await request("POST", "/api/runs", { prompt: "x", cwd: 3 })).status).toBe(400);
    });

    it("POST /api/runs accepts a valid run and spawns the at CLI", async () => {
      const t = await start();
      const res = await request("POST", "/api/runs", { prompt: "fix the bug", agent: "mock", tier: 4 });
      expect(res.status).toBe(202);
      expect(JSON.parse(res.body).ok).toBe(true);
      const spawned = await hooks.spawnedArgs(t);
      expect(spawned).toHaveLength(1);
      expect(spawned[0]).toEqual(["-p", "fix the bug", "-a", "mock", "-t", "4"]);
    });

    it("POST /api/runs/:id/retry respawns stored prompt/agent/tier, 404 on unknown", async () => {
      const run = makeRun({
        agent: "mock",
        tier: 4,
        status: "failed",
        exitCode: 1,
        finishedAt: new Date().toISOString(),
      });
      saveRuns(stateDir, [run]);
      const t = await start();
      const res = await request("POST", `/api/runs/${run.runId}/retry`);
      expect(res.status).toBe(202);
      const spawned = await hooks.spawnedArgs(t);
      expect(spawned[0]).toEqual(["-p", run.prompt, "-a", "mock", "-t", "4"]);
      expect((await request("POST", "/api/runs/nope/retry")).status).toBe(404);
    });

    it("DELETE /api/runs/:id kills the process group and marks the run failed", async () => {
      const pid = spawnSleep();
      const run = makeRun({ pid });
      saveRuns(stateDir, [run]);
      await start();
      const res = await request("DELETE", `/api/runs/${run.runId}`);
      expect(res.status).toBe(200);
      expect(JSON.parse(res.body).ok).toBe(true);
      await expectPidDead(pid);
      const stored = JSON.parse(readFileSync(path.join(stateDir, "runs.jsonl"), "utf8").trim().split("\n")[0]!);
      expect(stored.status).toBe("failed");
      expect(stored.finishedAt).not.toBeNull();
      expect((await request("DELETE", "/api/runs/nope")).status).toBe(404);
    });

    it("DELETE /api/runs/:id?force=1 kills with SIGKILL", async () => {
      const pid = spawnSleep();
      const run = makeRun({ pid });
      saveRuns(stateDir, [run]);
      await start();
      const res = await request("DELETE", `/api/runs/${run.runId}?force=1`);
      expect(res.status).toBe(200);
      await expectPidDead(pid);
    });

    it("DELETE /api/runs/:id on a dead pid is idempotent and still marks failed", async () => {
      const run = makeRun({ pid: 999999 });
      saveRuns(stateDir, [run]);
      await start();
      const res = await request("DELETE", `/api/runs/${run.runId}`);
      expect(res.status).toBe(200);
      const stored = JSON.parse(readFileSync(path.join(stateDir, "runs.jsonl"), "utf8").trim().split("\n")[0]!);
      expect(stored.status).toBe("failed");
    });

    it("GET /api/agents lists agents with health fields", async () => {
      await start();
      const res = await get("/api/agents");
      expect(res.status).toBe(200);
      const agents = JSON.parse(res.body) as Array<Record<string, unknown>>;
      expect(agents.map((a) => a.name)).toContain("mock");
      for (const a of agents) {
        expect(typeof a.tier).toBe("number");
        expect(a).toHaveProperty("deactivated");
        expect(a).toHaveProperty("failures");
        expect(a).toHaveProperty("lastFailure");
        expect(a).toHaveProperty("disabledTo");
      }
    });

    it("PUT /api/agents/:name/disable|enable toggles deactivated, 404 on unknown", async () => {
      await start();
      expect((await request("PUT", "/api/agents/nope/disable")).status).toBe(404);

      expect((await request("PUT", "/api/agents/mock/disable")).status).toBe(202);
      let agents = JSON.parse((await get("/api/agents")).body) as Array<{ name: string; deactivated: boolean }>;
      expect(agents.find((a) => a.name === "mock")!.deactivated).toBe(true);

      expect((await request("PUT", "/api/agents/mock/enable")).status).toBe(202);
      agents = JSON.parse((await get("/api/agents")).body) as Array<{ name: string; deactivated: boolean }>;
      expect(agents.find((a) => a.name === "mock")!.deactivated).toBe(false);
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
      expect(JSON.parse((await get("/api/settings")).body)).toEqual({ defaultTier: 2, retries: 3 });

      expect((await request("PUT", "/api/settings", [1, 2])).status).toBe(400);
      expect((await request("PUT", "/api/settings", "nope")).status).toBe(400);
    });
  });
}

/** Read SSE messages from an http response for `durationMs`, returning parsed data payloads. */
function collectSSE(res: http.IncomingMessage, durationMs: number, abort: () => void): Promise<unknown[]> {
  return new Promise((resolve) => {
    const found: unknown[] = [];
    let buffer = "";
    let settled = false;
    const finish = (value: unknown[]) => {
      if (settled) return;
      settled = true;
      try {
        abort();
      } catch {
        // ignore
      }
      try {
        res.destroy();
      } catch {
        // ignore
      }
      resolve(value);
    };
    setTimeout(() => finish(found), durationMs);
    res.on("data", (chunk: Buffer) => {
      buffer += chunk.toString();
      const parts = buffer.split("\n\n");
      buffer = parts.pop() ?? "";
      for (const part of parts) {
        const dataLine = part.split("\n").find((l) => l.startsWith("data:"));
        if (dataLine) {
          try {
            found.push(JSON.parse(dataLine.slice(5)));
          } catch {
            // ignore malformed
          }
        }
      }
    });
    res.on("close", () => finish(found));
    res.on("error", () => finish(found));
  });
}

function seedEventsFile(stateDir: string, runId: string, lines: string[]): void {
  const dir = path.join(stateDir, "events");
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, `${runId}.jsonl`), `${lines.join("\n")}\n`);
}

function seedDiscussFile(stateDir: string, runId: string, lines: string[]): void {
  const dir = path.join(stateDir, "events");
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, `${runId}.discuss.jsonl`), `${lines.join("\n")}\n`);
}

export function describeWebApiSSEContract(name: string, hooks: ContractHooks): void {
  describe(name, () => {
    let stateDir: string;
    let target: ContractTarget | undefined;

    beforeEach(() => {
      stateDir = mkdtempSync(path.join(tmpdir(), "at-web-sse-"));
    });

    afterEach(async () => {
      await target?.close();
      target = undefined;
      rmSync(stateDir, { recursive: true, force: true });
    });

    async function start(): Promise<ContractTarget> {
      target = await hooks.start(stateDir);
      return target;
    }

    function request(method: string, apiPath: string, body?: unknown): Promise<{ status: number; body: string }> {
      return new Promise((resolve, reject) => {
        const data = body === undefined ? undefined : JSON.stringify(body);
        const req = http.request(
          `${target!.baseUrl}${apiPath}`,
          {
            method,
            headers:
              data !== undefined
                ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(data) }
                : {},
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

    function sseRequest(
      apiPath: string,
      lastEventId?: string,
    ): Promise<{ res: http.IncomingMessage; abort: () => void }> {
      return new Promise((resolve, reject) => {
        const controller = new AbortController();
        const req = http.get(
          `${target!.baseUrl}${apiPath}`,
          { headers: lastEventId ? { "Last-Event-ID": lastEventId } : {}, signal: controller.signal as any },
          (res) => {
            resolve({ res, abort: () => controller.abort() });
          },
        );
        req.on("error", reject);
      });
    }

    it("GET /api/events/:runId replays stored events", async () => {
      await start();
      const run = makeRun({ runId: "sse-replay-1" });
      saveRuns(stateDir, [run]);
      seedEventsFile(stateDir, run.runId, [
        `{"runId":"${run.runId}","agent":"mock","ts":"2026-10-13T09:00:00.000Z","seq":1,"type":"start"}`,
        `{"runId":"${run.runId}","agent":"mock","ts":"2026-10-13T09:00:01.000Z","seq":2,"type":"message","text":"hello"}`,
      ]);

      const { res, abort } = await sseRequest(`/api/events/${run.runId}`);
      const events = await collectSSE(res, 150, abort);
      expect(events).toHaveLength(2);
      expect((events[0] as { type: string }).type).toBe("start");
      expect((events[1] as { text: string }).text).toBe("hello");
    });

    it("GET /api/events/:runId honors Last-Event-ID", async () => {
      await start();
      const run = makeRun({ runId: "sse-resume-1" });
      saveRuns(stateDir, [run]);
      seedEventsFile(stateDir, run.runId, [
        `{"runId":"${run.runId}","agent":"mock","ts":"2026-10-13T09:00:00.000Z","seq":1,"type":"start"}`,
        `{"runId":"${run.runId}","agent":"mock","ts":"2026-10-13T09:00:01.000Z","seq":2,"type":"message","text":"a"}`,
        `{"runId":"${run.runId}","agent":"mock","ts":"2026-10-13T09:00:02.000Z","seq":3,"type":"message","text":"b"}`,
      ]);

      const { res, abort } = await sseRequest(`/api/events/${run.runId}`, "1");
      const events = await collectSSE(res, 150, abort);
      expect(events).toHaveLength(2);
      expect((events[0] as { seq: number }).seq).toBe(2);
      expect((events[1] as { seq: number }).seq).toBe(3);
    });

    it("GET /api/events replays events across all runs sorted by seq", async () => {
      await start();
      const a = makeRun({ runId: "all-a" });
      const b = makeRun({ runId: "all-b" });
      saveRuns(stateDir, [a, b]);
      seedEventsFile(stateDir, "all-a", [
        `{"runId":"all-a","agent":"mock","ts":"2026-10-13T09:00:00.000Z","seq":5,"type":"message","text":"a"}`,
      ]);
      seedEventsFile(stateDir, "all-b", [
        `{"runId":"all-b","agent":"mock","ts":"2026-10-13T09:00:00.000Z","seq":2,"type":"message","text":"b"}`,
      ]);

      const { res, abort } = await sseRequest("/api/events");
      const events = await collectSSE(res, 150, abort);
      expect(events).toHaveLength(2);
      expect((events[0] as { seq: number }).seq).toBe(2);
      expect((events[1] as { seq: number }).seq).toBe(5);
    });

    it("GET /api/runs/:id/discuss returns thread; ?pending=1 returns unanswered questions", async () => {
      await start();
      const run = makeRun({ runId: "discuss-1" });
      saveRuns(stateDir, [run]);
      seedDiscussFile(stateDir, run.runId, [
        `{"id":"m1","from":"agent","kind":"question","text":"which port?","ts":"2026-10-13T09:00:00.000Z"}`,
        `{"id":"m2","from":"host","kind":"answer","text":"7800","replyTo":"m1","ts":"2026-10-13T09:00:01.000Z"}`,
        `{"id":"m3","from":"agent","kind":"question","text":"which dir?","ts":"2026-10-13T09:00:02.000Z"}`,
      ]);

      const thread = await request("GET", `/api/runs/${run.runId}/discuss`);
      expect(thread.status).toBe(200);
      const entries = JSON.parse(thread.body) as { text: string }[];
      expect(entries.map((e) => e.text)).toEqual(["which port?", "7800", "which dir?"]);

      const pending = await request("GET", `/api/runs/${run.runId}/discuss?pending=1`);
      expect(pending.status).toBe(200);
      const pendingEntries = JSON.parse(pending.body) as { text: string }[];
      expect(pendingEntries.map((e) => e.text)).toEqual(["which dir?"]);
    });

    it("POST /api/runs/:id/discuss appends a host answer and empties pending", async () => {
      await start();
      const run = makeRun({ runId: "discuss-2" });
      saveRuns(stateDir, [run]);
      seedDiscussFile(stateDir, run.runId, [
        `{"id":"m1","from":"agent","kind":"question","text":"continue?","ts":"2026-10-13T09:00:00.000Z"}`,
      ]);

      const bad = await request("POST", `/api/runs/${run.runId}/discuss`, { kind: "answer", text: "" });
      expect(bad.status).toBe(400);

      const res = await request("POST", `/api/runs/${run.runId}/discuss`, {
        kind: "answer",
        text: "yes",
        replyTo: "m1",
      });
      expect(res.status).toBe(202);
      expect(JSON.parse(res.body)).toEqual({ id: "m2" });

      const pending = await request("GET", `/api/runs/${run.runId}/discuss?pending=1`);
      expect(JSON.parse(pending.body)).toEqual([]);
    });

    it("POST /api/runs/:id/discuss mirrors the entry as an SSE event", async () => {
      await start();
      const run = makeRun({ runId: "discuss-3" });
      saveRuns(stateDir, [run]);

      const { res, abort } = await sseRequest(`/api/events/${run.runId}`);
      await new Promise((r) => setTimeout(r, 30));
      const post = await request("POST", `/api/runs/${run.runId}/discuss`, { kind: "say", text: "now bump" });
      expect(post.status).toBe(202);
      const events = await collectSSE(res, 150, abort);
      expect(events).toHaveLength(1);
      const ev = events[0] as { type: string; text: string; data: { kind: string } };
      expect(ev.type).toBe("message");
      expect(ev.text).toBe("now bump");
      expect(ev.data.kind).toBe("say");
    });

    it("discuss routes 404 on unknown run id", async () => {
      await start();
      saveRuns(stateDir, [makeRun({ runId: "abcdef123456" })]);
      expect((await request("GET", "/api/runs/abc/discuss")).status).toBe(200);
      expect((await request("GET", "/api/runs/nope/discuss")).status).toBe(404);
      expect((await request("POST", "/api/runs/nope/discuss", { kind: "say", text: "hi" })).status).toBe(404);
    });
  });
}
