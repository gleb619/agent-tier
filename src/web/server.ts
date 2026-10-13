import { spawn } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import http from "node:http";
import path from "node:path";
import { loadGenericAgents } from "../agents/generic-loader";
import { AGENTS } from "../agents/registry";
import { buildAgentsReport } from "../agents/report";
import { writeFileAtomicSync } from "../atomic-write";
import { setDeactivated } from "../health";
import { withLock } from "../lock";
import type { Hub } from "../notify/hub";
import { isPidAlive } from "../process-utils";
import { loadRuns, type RunRecord, refreshRuns, updateRun } from "../run-store";
import { getStateFilePath } from "../state-dir";
import { buildStateReport, joinRuns } from "../status";

export interface WebServer {
  port: number;
  /** The port requested by the caller (may differ from `port` on busy-port fallback). */
  requestedPort: number;
  close(): Promise<void>;
}

export interface WebServerOptions {
  /** Joined state dirs, same resolution as `at status` (`resolveStatusDirs`). */
  stateDirs: string[];
  /** Notify hub whose `/events` stream is proxied under `/api/events`. */
  hub: Hub;
  /** Listen port; 0 (default) = random free port. */
  port?: number;
  /** Bind address (default 127.0.0.1; use 0.0.0.0 for containers). */
  host?: string;
  /** WebUI build output dir; absent/missing → static routes 404. */
  staticDir?: string;
  /**
   * Run launcher, injectable for tests. Default spawns the `at` CLI detached
   * (`process.execPath` + `process.argv[1]`), so the child runs the normal
   * CLI flow (runner, retry, supervisor, namer) and lands its own run record.
   */
  spawnAt?: (args: string[]) => void;
}

const DEFAULT_LOG_TAIL_LINES = 200;
const DEFAULT_HOST = "127.0.0.1";

/**
 * Default WebUI build dir: <package root>/src/webui/dist. The compiled server
 * lives at dist/web/server.js, so two levels up is the package root.
 */
export function defaultWebUiStaticDir(rootDir: string = path.resolve(__dirname, "..", "..")): string {
  return path.join(rootDir, "src", "webui", "dist");
}

/**
 * Resolve which static dir `at web` serves: the explicit `--static` value if
 * given, else the built WebUI (src/webui/dist) when present, else undefined
 * (API-only mode).
 */
export function resolveWebUiStaticDir(explicit?: string, rootDir?: string): string | undefined {
  if (explicit) return path.resolve(explicit);
  const dir = defaultWebUiStaticDir(rootDir);
  return existsSync(dir) ? dir : undefined;
}

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".map": "application/json",
  ".txt": "text/plain; charset=utf-8",
  ".wasm": "application/wasm",
};

function settingsFile(stateDirs: string[]): string {
  return path.join(stateDirs[0] ?? path.join(process.cwd(), ".at"), "web-settings.json");
}

function loadSettings(file: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8")) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/** Build the `at` CLI argv for a (re)run. The child writes its own run record. */
export function buildAtArgs(run: { prompt: string; agent?: string; tier?: number }): string[] {
  const args = [process.execPath, process.argv[1] ?? process.execPath, "-p", run.prompt];
  if (run.agent) args.push("-a", run.agent);
  if (run.tier !== undefined) args.push("-t", String(run.tier));
  return args;
}

function defaultSpawnAt(stateDirs: string[]): (args: string[]) => void {
  return (args) => {
    const child = spawn(args[0]!, args.slice(1), {
      detached: true,
      stdio: "ignore",
      env: { ...process.env, AT_STATE_DIR: stateDirs[0] },
    });
    child.once("error", () => {});
    child.unref();
  };
}

/** Find a run across the joined dirs (prefix match, like `at stop`). */
function findRun(stateDirs: string[], runId: string): { run: RunRecord; dir: string } | undefined {
  return stateDirs
    .flatMap((dir) => loadRuns(dir).map((run) => ({ run, dir })))
    .find((e) => e.run.runId === runId || e.run.runId.startsWith(runId));
}

function killPid(pid: number, signal: NodeJS.Signals): void {
  // Runs are spawned detached → the stored pid is a process-group leader and
  // -pid takes down the whole tree. Fall back to the bare pid when the
  // process is not a group leader.
  try {
    process.kill(-pid, signal);
  } catch {
    process.kill(pid, signal);
  }
}

function readJsonBody(req: http.IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let body = "";
    req.setEncoding("utf8");
    req.on("data", (chunk: string) => (body += chunk));
    req.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : undefined);
      } catch (err) {
        reject(err);
      }
    });
    req.on("error", reject);
  });
}

function sendJson(res: http.ServerResponse, status: number, data: unknown): void {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data));
}

function sendError(res: http.ServerResponse, status: number, message: string): void {
  sendJson(res, status, { error: message });
}

/** Serve a file from staticDir; SPA-fallback to index.html for extensionless/missing paths. */
function serveStatic(staticDir: string, urlPath: string, res: http.ServerResponse): void {
  let rel: string;
  try {
    rel = decodeURIComponent(urlPath.split("?")[0] ?? "/");
  } catch {
    sendError(res, 400, "bad path");
    return;
  }
  if (rel.includes("\0")) {
    sendError(res, 400, "bad path");
    return;
  }
  const resolved = path.resolve(staticDir, `.${path.posix.normalize(`/${rel}`)}`);
  if (resolved !== path.resolve(staticDir) && !resolved.startsWith(path.resolve(staticDir) + path.sep)) {
    sendError(res, 403, "forbidden");
    return;
  }

  let filePath = resolved;
  if (!existsSync(filePath) || statSync(filePath).isDirectory()) {
    // SPA fallback: unknown paths render the app shell.
    filePath = path.join(staticDir, "index.html");
    if (!existsSync(filePath)) {
      sendError(res, 404, "not found");
      return;
    }
  }

  const type = MIME_TYPES[path.extname(filePath).toLowerCase()] ?? "application/octet-stream";
  try {
    const data = readFileSync(filePath);
    res.writeHead(200, { "Content-Type": type });
    res.end(data);
  } catch {
    sendError(res, 404, "not found");
  }
}

/** Pipe the hub's SSE stream (replay + live) to the client. */
function proxyEvents(hubPort: number, hubPath: string, req: http.IncomingMessage, res: http.ServerResponse): void {
  const headers: Record<string, string> = { Accept: "text/event-stream" };
  const lastEventId = req.headers["last-event-id"];
  if (typeof lastEventId === "string") headers["Last-Event-ID"] = lastEventId;
  const upstream = http.get({ host: "127.0.0.1", port: hubPort, path: hubPath, headers }, (upstreamRes) => {
    res.writeHead(upstreamRes.statusCode ?? 200, {
      "Content-Type": upstreamRes.headers["content-type"] ?? "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });
    upstreamRes.pipe(res);
  });
  upstream.on("error", () => {
    if (!res.headersSent) sendError(res, 502, "events hub unreachable");
    else res.end();
  });
  req.on("close", () => upstream.destroy());
  req.on("error", () => upstream.destroy());
}

/** JSON request/response round-trip to the notify hub (used for discuss proxying). */
function hubJsonRequest(
  hubPort: number,
  hubPath: string,
  method: string,
  body?: unknown,
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? undefined : JSON.stringify(body);
    const req = http.request(
      {
        host: "127.0.0.1",
        port: hubPort,
        path: hubPath,
        method,
        headers:
          payload === undefined
            ? undefined
            : { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload) },
      },
      (upstreamRes) => {
        let data = "";
        upstreamRes.setEncoding("utf8");
        upstreamRes.on("data", (chunk: string) => (data += chunk));
        upstreamRes.on("end", () => resolve({ status: upstreamRes.statusCode ?? 502, body: data }));
      },
    );
    req.on("error", reject);
    if (payload !== undefined) req.write(payload);
    req.end();
  });
}

function listen(server: http.Server, port: number, host: string): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      const addr = server.address();
      resolve(typeof addr === "object" && addr ? addr.port : port);
    });
  });
}

export function startWebServer(options: WebServerOptions): Promise<WebServer> {
  const { stateDirs, hub, staticDir } = options;
  const spawnAt = options.spawnAt ?? defaultSpawnAt(stateDirs);
  const resolvedStaticDir = staticDir ? path.resolve(staticDir) : undefined;

  const server = http.createServer((req, res) => {
    void handle(req, res).catch(() => {
      if (!res.headersSent) sendError(res, 500, "internal error");
      else res.end();
    });
  });

  async function handle(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const method = req.method ?? "GET";
    const url = req.url ?? "/";
    const routePath = url.split("?")[0] ?? "/";

    // --- SSE proxy -------------------------------------------------------
    const eventsMatch = routePath.match(/^\/api\/events(?:\/([^/]+))?$/);
    if (eventsMatch && method === "GET") {
      const runId = eventsMatch[1] ? decodeURIComponent(eventsMatch[1]) : undefined;
      proxyEvents(hub.port, runId ? `/events/${encodeURIComponent(runId)}` : "/events", req, res);
      return;
    }

    // --- REST ------------------------------------------------------------
    if (routePath === "/api/runs" && method === "GET") {
      const runsPerDir: RunRecord[][] = [];
      for (const dir of stateDirs) {
        runsPerDir.push(await refreshRuns(dir));
      }
      sendJson(res, 200, joinRuns(stateDirs, runsPerDir));
      return;
    }

    if (routePath === "/api/runs" && method === "POST") {
      const body = (await readJsonBody(req)) as { prompt?: unknown; agent?: unknown; tier?: unknown; cwd?: unknown };
      if (typeof body?.prompt !== "string" || body.prompt.trim().length === 0) {
        sendError(res, 400, "prompt is required");
        return;
      }
      if (body.agent !== undefined && typeof body.agent !== "string") {
        sendError(res, 400, "agent must be a string");
        return;
      }
      if (body.tier !== undefined && ![1, 2, 3, 4].includes(body.tier as number)) {
        sendError(res, 400, "tier must be 1, 2, 3 or 4");
        return;
      }
      if (body.cwd !== undefined && typeof body.cwd !== "string") {
        sendError(res, 400, "cwd must be a string");
        return;
      }
      const args = buildAtArgs({
        prompt: body.prompt,
        agent: body.agent as string | undefined,
        tier: body.tier as number | undefined,
      });
      spawnAt(args);
      sendJson(res, 202, { ok: true });
      return;
    }

    const retryMatch = routePath.match(/^\/api\/runs\/([^/]+)\/retry$/);
    if (retryMatch && method === "POST") {
      const target = findRun(stateDirs, decodeURIComponent(retryMatch[1] ?? ""));
      if (!target) {
        sendError(res, 404, "run not found");
        return;
      }
      spawnAt(buildAtArgs({ prompt: target.run.prompt, agent: target.run.agent, tier: target.run.tier }));
      sendJson(res, 202, { ok: true });
      return;
    }

    const runMatch = routePath.match(/^\/api\/runs\/([^/]+)$/);
    if (runMatch) {
      const runId = decodeURIComponent(runMatch[1] ?? "");
      if (method === "GET") {
        const target = findRun(stateDirs, runId);
        if (!target) {
          sendError(res, 404, "run not found");
          return;
        }
        sendJson(res, 200, target.run);
        return;
      }
      if (method === "DELETE") {
        const target = findRun(stateDirs, runId);
        if (!target) {
          sendError(res, 404, "run not found");
          return;
        }
        const { run, dir } = target;
        if (isPidAlive(run.pid)) {
          const force = /[?&]force=1\b/.test(url);
          killPid(run.pid, force ? "SIGKILL" : "SIGTERM");
        }
        await updateRun(dir, run.runId, { status: "failed", finishedAt: new Date().toISOString() });
        sendJson(res, 200, { ok: true });
        return;
      }
    }

    const logMatch = routePath.match(/^\/api\/runs\/([^/]+)\/log$/);
    if (logMatch && method === "GET") {
      const target = findRun(stateDirs, decodeURIComponent(logMatch[1] ?? ""));
      if (!target) {
        sendError(res, 404, "run not found");
        return;
      }
      const linesParam = Number(new URL(url, "http://x").searchParams.get("lines") ?? DEFAULT_LOG_TAIL_LINES);
      const lines = Number.isFinite(linesParam) && linesParam > 0 ? Math.floor(linesParam) : DEFAULT_LOG_TAIL_LINES;
      let raw: string;
      try {
        raw = readFileSync(target.run.logFile, "utf8");
      } catch {
        sendError(res, 404, "log file not found");
        return;
      }
      const all = raw.split("\n");
      if (all[all.length - 1] === "") all.pop();
      sendJson(res, 200, { runId: target.run.runId, lines: all.slice(-lines) });
      return;
    }

    // --- Discuss proxy (hub owns the thread; SSE mirror stays on the hub) ---
    const discussMatch = routePath.match(/^\/api\/runs\/([^/]+)\/discuss$/);
    if (discussMatch) {
      const target = findRun(stateDirs, decodeURIComponent(discussMatch[1] ?? ""));
      if (!target) {
        sendError(res, 404, "run not found");
        return;
      }
      const hubPath = `/discuss/${encodeURIComponent(target.run.runId)}`;
      if (method === "GET") {
        const pending = /[?&]pending=1\b/.test(url);
        try {
          const upstream = await hubJsonRequest(hub.port, pending ? `${hubPath}?pending=1` : hubPath, "GET");
          res.writeHead(upstream.status, { "Content-Type": "application/json" });
          res.end(upstream.body);
        } catch {
          sendError(res, 502, "events hub unreachable");
        }
        return;
      }
      if (method === "POST") {
        let body: unknown;
        try {
          body = await readJsonBody(req);
        } catch {
          sendError(res, 400, "invalid JSON");
          return;
        }
        const input = body as { kind?: unknown; text?: unknown; options?: unknown; replyTo?: unknown };
        const kind = input?.kind;
        const text = typeof input?.text === "string" ? input.text : "";
        if (!text || (kind !== "question" && kind !== "answer" && kind !== "say" && kind !== "note")) {
          sendError(res, 400, "bad request");
          return;
        }
        const options = Array.isArray(input.options)
          ? input.options.filter((o): o is string => typeof o === "string")
          : undefined;
        const replyTo = typeof input?.replyTo === "string" ? input.replyTo : undefined;
        try {
          const upstream = await hubJsonRequest(hub.port, hubPath, "POST", {
            from: "host",
            kind,
            text,
            ...(options?.length ? { options } : {}),
            ...(replyTo ? { replyTo } : {}),
          });
          if (upstream.status === 202) {
            res.writeHead(202, { "Content-Type": "application/json" });
            res.end(upstream.body);
          } else {
            sendError(res, upstream.status, "discuss hub rejected the entry");
          }
        } catch {
          sendError(res, 502, "events hub unreachable");
        }
        return;
      }
    }

    if (routePath === "/api/agents" && method === "GET") {
      sendJson(res, 200, buildAgentsReport(stateDirs));
      return;
    }

    const agentActionMatch = routePath.match(/^\/api\/agents\/([^/]+)\/(enable|disable)$/);
    if (agentActionMatch && method === "PUT") {
      const name = decodeURIComponent(agentActionMatch[1] ?? "");
      const known = [...AGENTS, ...loadGenericAgents()].some((a) => a.name === name);
      if (!known) {
        sendError(res, 404, "unknown agent");
        return;
      }
      await setDeactivated(getStateFilePath(stateDirs[0]!), name, agentActionMatch[2] === "disable");
      sendJson(res, 202, { ok: true });
      return;
    }

    if (routePath === "/api/stats" && method === "GET") {
      const runsPerDir: RunRecord[][] = [];
      for (const dir of stateDirs) {
        runsPerDir.push(await refreshRuns(dir));
      }
      const runs = joinRuns(stateDirs, runsPerDir);
      const allAgents = [...AGENTS, ...loadGenericAgents()];
      const deactivated = new Set<string>();
      for (const dir of stateDirs) {
        for (const entry of buildStateReport(dir, { quiet: true }).agents) {
          if (entry.deactivated) deactivated.add(entry.name);
        }
      }
      sendJson(res, 200, {
        total: runs.length,
        running: runs.filter((r) => r.status === "running").length,
        done: runs.filter((r) => r.status === "done").length,
        failed: runs.filter((r) => r.status === "failed").length,
        stuck: runs.filter((r) => r.status === "stuck").length,
        agents: { total: allAgents.length, deactivated: deactivated.size },
      });
      return;
    }

    if (routePath === "/api/settings") {
      const file = settingsFile(stateDirs);
      if (method === "GET") {
        sendJson(res, 200, loadSettings(file));
        return;
      }
      if (method === "PUT") {
        let body: unknown;
        try {
          body = await readJsonBody(req);
        } catch {
          sendError(res, 400, "invalid JSON");
          return;
        }
        if (!body || typeof body !== "object" || Array.isArray(body)) {
          sendError(res, 400, "settings must be a JSON object");
          return;
        }
        await withLock(file, () => writeFileAtomicSync(file, `${JSON.stringify(body, null, 2)}\n`));
        sendJson(res, 200, body);
        return;
      }
    }

    // --- Static ----------------------------------------------------------
    if (method === "GET" && !routePath.startsWith("/api/")) {
      if (resolvedStaticDir && existsSync(resolvedStaticDir)) {
        serveStatic(resolvedStaticDir, url, res);
        return;
      }
      sendError(res, 404, "not found");
      return;
    }

    sendError(res, 404, "not found");
  }

  return listen(server, options.port ?? 0, options.host ?? DEFAULT_HOST).then((port) => ({
    port,
    requestedPort: options.port ?? 0,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
        const maybe = server as unknown as { closeAllConnections?: () => void };
        if (typeof maybe.closeAllConnections === "function") {
          try {
            maybe.closeAllConnections();
          } catch {}
        }
        setTimeout(resolve, 1000).unref();
      }),
  }));
}
