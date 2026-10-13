import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import http from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { startHub } from "../src/notify/hub";
import { saveRuns } from "../src/run-store";
import { resolveWebUiStaticDir, startWebServer, type WebServer } from "../src/web/server";
import { type ContractTarget, describeWebApiContract, makeRun } from "./web-contract";

// Node backend wrapper for the shared REST contract: boots the in-process
// server (src/web/server.ts) with a mocked detached `at` spawn.
describeWebApiContract("web server contract (node)", {
  async start(stateDir) {
    const hub = await startHub({ stateDir, port: 0 });
    const spawned: string[][] = [];
    const server = await startWebServer({
      stateDirs: [stateDir],
      hub,
      port: 0,
      spawnAt: (args: string[]) => {
        // Record only the `at` argv (drop [node, cli.js]) to match what the
        // Go backend captures when it spawns the `at` binary directly.
        spawned.push(args.slice(2));
      },
    });
    return {
      baseUrl: `http://127.0.0.1:${server.port}`,
      async close() {
        await server.close();
        await hub.close();
      },
      __spawned: spawned,
    } as ContractTarget & { __spawned: string[][] };
  },
  async spawnedArgs(target) {
    return (target as ContractTarget & { __spawned: string[][] }).__spawned;
  },
});

describe("web server (node-only surface)", () => {
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

  it("POST /api/runs spawns the node CLI argv (process.execPath + entry)", async () => {
    const spawnAt = vi.fn();
    await start({ spawnAt });
    const res = await request("POST", "/api/runs", { prompt: "fix the bug", agent: "mock", tier: 4 });
    expect(res.status).toBe(202);
    expect(spawnAt).toHaveBeenCalledTimes(1);
    const args = spawnAt.mock.calls[0]![0] as string[];
    expect(args).toEqual([process.execPath, process.argv[1], "-p", "fix the bug", "-a", "mock", "-t", "4"]);
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

  it("resolveWebUiStaticDir: explicit dir wins; falls back to built webui; undefined when absent", () => {
    const root = mkdtempSync(path.join(tmpdir(), "at-web-root-"));
    try {
      expect(resolveWebUiStaticDir("/some/dir")).toBe(path.resolve("/some/dir"));
      expect(resolveWebUiStaticDir(undefined, root)).toBeUndefined();
      mkdirSync(path.join(root, "src", "webui", "dist"), { recursive: true });
      expect(resolveWebUiStaticDir(undefined, root)).toBe(path.join(root, "src", "webui", "dist"));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("listens on the requested host", async () => {
    hub = await startHub({ stateDir, port: 0 });
    server = await startWebServer({ stateDirs: [stateDir], hub, port: 0, host: "0.0.0.0" });
    expect((await get("/api/runs")).status).toBe(200);
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
