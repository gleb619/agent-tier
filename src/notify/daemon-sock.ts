import { existsSync, mkdirSync, unlinkSync, writeFileSync } from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import type { DiscussEntry, NotifyEvent } from "./types";

/**
 * Unix-socket transport for the `at` daemon hub.
 *
 * The daemon (`at serve --daemon`) owns one socket at `<stateDir>/daemon.sock`
 * and speaks newline-delimited JSON frames:
 *
 *   request : `{"id":"1","op":"emit","payload":{...}}\n`
 *   response: `{"id":"1","ok":true,"data":{...}}\n`
 *
 * Requests and answers are matched by `id`, so a client can pipeline several
 * frames over a single connection. Everything here is transport only — the
 * `emit`/`discuss`/write handlers live in `src/notify/hub.ts` and
 * `src/commands/serve.ts`, and every failure (missing daemon, stale socket,
 * timeout) resolves to `null` so callers fall back to their direct path.
 */

export const DAEMON_SOCK_FILE = "daemon.sock";
export const DAEMON_PID_FILE = "daemon.pid";
export const DAEMON_VERSION = "1";

const DEFAULT_CONNECT_TIMEOUT_MS = 250;
const DEFAULT_REQUEST_TIMEOUT_MS = 1000;
const BROKER_REQUEST_TIMEOUT_MS = 5000;

export interface DaemonRequest {
  id: string;
  op: string;
  payload?: unknown;
}

export interface DaemonResponse {
  id: string;
  ok: boolean;
  data?: unknown;
  error?: string;
}

export type DaemonFrameHandler = (req: DaemonRequest) => unknown | Promise<unknown>;

export interface DaemonServer {
  sockPath: string;
  close(): Promise<void>;
}

export interface DaemonClient {
  request(op: string, payload?: unknown, opts?: { timeoutMs?: number }): Promise<DaemonResponse>;
  close(): void;
}

export interface DaemonConnectOptions {
  timeoutMs?: number;
  /**
   * Brought up when the socket is missing (ENOENT), then retried once.
   * Callers pass `autostartDaemon` to actually spawn `at serve --daemon`;
   * without it a missing daemon is simply reported as unreachable.
   */
  spawn?: (stateDir: string) => void | Promise<void>;
}

export function daemonSockPath(stateDir: string): string {
  return path.join(stateDir, DAEMON_SOCK_FILE);
}

export function daemonPidPath(stateDir: string): string {
  return path.join(stateDir, DAEMON_PID_FILE);
}

/** The daemon is only ever consulted for its own state dir, unless disabled. */
export function isDaemonDisabled(): boolean {
  return !!process.env.AT_NO_DAEMON || !!process.env.AT_DEPTH;
}

export function isDaemonUp(stateDir: string): boolean {
  if (isDaemonDisabled()) return false;
  return existsSync(daemonSockPath(stateDir));
}

export function encodeFrame(frame: unknown): string {
  return `${JSON.stringify(frame)}\n`;
}

/** Split a buffer into complete newline-terminated frames + the leftover tail. */
export function splitFrames(buffer: string): { frames: string[]; rest: string } {
  const parts = buffer.split("\n");
  const rest = parts.pop() ?? "";
  return { frames: parts.filter((p) => p.trim().length > 0), rest };
}

function unlinkQuietly(target: string): void {
  try {
    unlinkSync(target);
  } catch {}
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * A socket file that no one is listening on (crashed daemon, plain file) would
 * pin `listen()` to EADDRINUSE forever. Probe it: only a refused/erroring
 * connect counts as stale.
 */
function socketIsLive(sockPath: string, timeoutMs = DEFAULT_CONNECT_TIMEOUT_MS): Promise<boolean> {
  return new Promise((resolve) => {
    if (!existsSync(sockPath)) {
      resolve(false);
      return;
    }
    const conn = net.connect({ path: sockPath });
    const timer = setTimeout(() => {
      conn.destroy();
      resolve(false);
    }, timeoutMs);
    const settle = (live: boolean) => {
      clearTimeout(timer);
      conn.destroy();
      resolve(live);
    };
    conn.once("connect", () => settle(true));
    conn.once("error", () => settle(false));
  });
}

export async function startDaemonServer({
  stateDir,
  handler,
  warn = (m) => console.warn(m),
}: {
  stateDir: string;
  handler: DaemonFrameHandler;
  warn?: (msg: string) => void;
}): Promise<DaemonServer> {
  mkdirSync(stateDir, { recursive: true });
  const sockPath = daemonSockPath(stateDir);

  if (existsSync(sockPath)) {
    if (await socketIsLive(sockPath)) {
      throw new Error(`daemon socket ${sockPath} is already served — another daemon is running`);
    }
    unlinkQuietly(sockPath);
  }

  const conns = new Set<net.Socket>();
  const server = net.createServer((conn) => {
    conns.add(conn);
    let buffer = "";
    conn.setEncoding("utf8");
    conn.on("data", (chunk: string) => {
      buffer += chunk;
      const { frames, rest } = splitFrames(buffer);
      buffer = rest;
      for (const frame of frames) void reply(conn, frame);
    });
    conn.on("error", () => {});
    conn.on("close", () => conns.delete(conn));
  });

  async function reply(conn: net.Socket, line: string): Promise<void> {
    let req: DaemonRequest;
    try {
      req = JSON.parse(line) as DaemonRequest;
    } catch {
      writeFrame(conn, { id: "", ok: false, error: "bad frame" });
      return;
    }
    if (!req || typeof req.op !== "string") {
      writeFrame(conn, { id: req?.id ?? "", ok: false, error: "bad request" });
      return;
    }
    try {
      const data = await handler(req);
      writeFrame(conn, { id: req.id, ok: true, data });
    } catch (err: unknown) {
      writeFrame(conn, { id: req.id, ok: false, error: err instanceof Error ? err.message : String(err) });
    }
  }

  function writeFrame(conn: net.Socket, frame: DaemonResponse): void {
    if (conn.destroyed || conn.writableEnded) return;
    try {
      conn.write(encodeFrame(frame));
    } catch (err: unknown) {
      warn(`[at] daemon: frame write failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  await new Promise<void>((resolve, reject) => {
    const onError = (err: Error) => {
      server.removeListener("listening", onListening);
      reject(err);
    };
    const onListening = () => {
      server.removeListener("error", onError);
      resolve();
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(sockPath);
  });

  return {
    sockPath,
    close(): Promise<void> {
      for (const conn of conns) {
        try {
          conn.destroy();
        } catch {}
      }
      conns.clear();
      return new Promise((resolve) => {
        server.close(() => {
          unlinkQuietly(sockPath);
          resolve();
        });
        // A hung keep-alive connection must not stall the shutdown.
        setTimeout(() => {
          unlinkQuietly(sockPath);
          resolve();
        }, 500).unref();
      });
    },
  };
}

function openSocket(sockPath: string, timeoutMs: number): Promise<net.Socket | null> {
  return new Promise((resolve) => {
    const conn = net.connect({ path: sockPath });
    let settled = false;
    const finish = (socket: net.Socket | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      conn.removeListener("connect", onConnect);
      conn.removeListener("error", onError);
      if (socket === null) conn.destroy();
      resolve(socket);
    };
    const timer = setTimeout(() => finish(null), timeoutMs);
    const onConnect = () => finish(conn);
    const onError = () => finish(null);
    conn.once("connect", onConnect);
    conn.once("error", onError);
  });
}

async function waitForSocket(sockPath: string, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (existsSync(sockPath)) return true;
    await sleep(25);
  }
  return existsSync(sockPath);
}

/**
 * Connect to the daemon hub, or resolve null when it is not reachable.
 * A missing socket with a `spawn` hook starts the daemon once and retries.
 */
export async function connectDaemon(stateDir: string, opts?: DaemonConnectOptions): Promise<DaemonClient | null> {
  if (isDaemonDisabled()) return null;
  const timeoutMs = opts?.timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
  const connectMs = Math.min(timeoutMs, DEFAULT_CONNECT_TIMEOUT_MS);
  const sockPath = daemonSockPath(stateDir);

  if (!existsSync(sockPath)) {
    if (!opts?.spawn) return null;
    try {
      await opts.spawn(stateDir);
    } catch {
      return null;
    }
    if (!(await waitForSocket(sockPath, timeoutMs))) return null;
  }

  const conn = await openSocket(sockPath, connectMs);
  if (!conn) return null;
  return makeClient(conn);
}

function makeClient(conn: net.Socket): DaemonClient {
  interface Pending {
    resolve: (res: DaemonResponse) => void;
    reject: (err: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  }
  const pending = new Map<string, Pending>();
  let seq = 0;
  let closed = false;

  const failAll = (message: string) => {
    closed = true;
    for (const [, entry] of pending) {
      clearTimeout(entry.timer);
      entry.reject(new Error(message));
    }
    pending.clear();
  };

  let buffer = "";
  conn.setEncoding("utf8");
  conn.on("data", (chunk: string) => {
    buffer += chunk;
    const { frames, rest } = splitFrames(buffer);
    buffer = rest;
    for (const frame of frames) {
      let res: DaemonResponse;
      try {
        res = JSON.parse(frame) as DaemonResponse;
      } catch {
        continue;
      }
      const entry = pending.get(res.id);
      if (!entry) continue;
      pending.delete(res.id);
      clearTimeout(entry.timer);
      entry.resolve(res);
    }
  });
  conn.on("error", () => failAll("daemon connection error"));
  conn.on("close", () => failAll("daemon connection closed"));

  // Named so the request-timeout path can tear the connection down without
  // depending on `this` binding inside the Promise executor.
  const closeClient = (): void => {
    failAll("daemon connection closed");
    try {
      conn.end();
    } catch {}
    try {
      conn.destroy();
    } catch {}
  };

  return {
    request(op: string, payload?: unknown, reqOpts?: { timeoutMs?: number }): Promise<DaemonResponse> {
      if (closed || conn.destroyed) return Promise.reject(new Error("daemon connection closed"));
      const timeoutMs = reqOpts?.timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
      seq += 1;
      const id = String(seq);
      return new Promise<DaemonResponse>((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(new Error(`daemon request '${op}' timed out after ${timeoutMs}ms`));
          closeClient();
        }, timeoutMs);
        timer.unref?.();
        pending.set(id, { resolve, reject, timer });
        try {
          conn.write(encodeFrame({ id, op, payload } satisfies DaemonRequest));
        } catch (err: unknown) {
          pending.delete(id);
          clearTimeout(timer);
          reject(err instanceof Error ? err : new Error(String(err)));
        }
      });
    },
    close: closeClient,
  };
}

export async function requestDaemon(
  stateDir: string,
  op: string,
  payload?: unknown,
  opts?: DaemonConnectOptions & { timeoutMs?: number },
): Promise<DaemonResponse | null> {
  if (isDaemonDisabled()) return null;
  const client = await connectDaemon(stateDir, opts);
  if (!client) return null;
  try {
    return await client.request(op, payload, { timeoutMs: opts?.timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS });
  } catch {
    return null;
  } finally {
    client.close();
  }
}

/** Publish an event through the daemon. False means "not delivered — do it yourself". */
export async function emitViaDaemon(stateDir: string, event: NotifyEvent): Promise<boolean> {
  if (!isDaemonUp(stateDir)) return false;
  const res = await requestDaemon(stateDir, "emit", event, { timeoutMs: DEFAULT_REQUEST_TIMEOUT_MS });
  return !!res?.ok;
}

export async function discussViaDaemon(
  stateDir: string,
  runId: string,
  entry: Omit<DiscussEntry, "id" | "ts">,
): Promise<string | null> {
  if (!isDaemonUp(stateDir)) return null;
  const res = await requestDaemon(
    stateDir,
    "discuss",
    { runId, ...entry },
    {
      timeoutMs: DEFAULT_REQUEST_TIMEOUT_MS,
    },
  );
  if (!res?.ok) return null;
  const id = (res.data as { id?: string } | undefined)?.id;
  return typeof id === "string" ? id : null;
}

/**
 * Ask the daemon to run a serialized write for us. Null means the caller must
 * take the file lock itself. `runs.*` / `state.*` ops are the broker surface.
 */
export async function brokerRunStore(
  stateDir: string,
  op: string,
  payload: Record<string, unknown>,
): Promise<DaemonResponse | null> {
  if (!isDaemonUp(stateDir)) return null;
  const res = await requestDaemon(stateDir, op, payload, { timeoutMs: BROKER_REQUEST_TIMEOUT_MS });
  return res?.ok ? res : null;
}

/** Spawn a detached hub daemon for `stateDir` (`at serve --daemon`). */
export async function autostartDaemon(stateDir: string): Promise<void> {
  const { spawn } = await import("node:child_process");
  const exe = process.execPath;
  const script = process.argv[1];
  const args = script ? [script, "serve", "--daemon"] : ["serve", "--daemon"];
  const child = spawn(exe, args, {
    detached: true,
    stdio: "ignore",
    env: {
      ...process.env,
      AT_STATE_DIR: stateDir,
      AT_DAEMON: "1",
      AT_DEPTH: String(Number(process.env.AT_DEPTH ?? 0) + 1),
    },
  });
  child.unref();
  child.on("error", () => {});
}

/** Daemon-side bookkeeping helper: the pid file the hub advertises. */
export function writeDaemonPidFile(stateDir: string, pid = process.pid): string {
  mkdirSync(stateDir, { recursive: true });
  const file = daemonPidPath(stateDir);
  writeFileSync(file, String(pid), "utf8");
  return file;
}

export function removeDaemonPidFile(stateDir: string): void {
  unlinkQuietly(daemonPidPath(stateDir));
}

export function defaultStateDirForDaemon(): string {
  return process.env.AT_STATE_DIR || path.join(os.homedir(), ".at");
}
