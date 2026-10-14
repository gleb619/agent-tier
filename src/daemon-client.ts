import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";

export const DAEMON_VERSION = "0.1.0";

export function daemonSockPath(): string {
  const dir = process.env.AT_STATE_DIR || path.join(os.homedir(), ".at");
  return path.join(dir, "atd.sock");
}

export function daemonPidPath(): string {
  const dir = process.env.AT_STATE_DIR || path.join(os.homedir(), ".at");
  return path.join(dir, "atd.pid");
}

export function isDaemonDisabled(): boolean {
  return !!process.env.AT_NO_DAEMON || !!process.env.AT_DEPTH;
}

export function spawnDaemon(): number | undefined {
  const bin = process.env.AT_DAEMON_BIN || "atd";
  const child = spawn(bin, ["--idle-ms", "300000"], {
    detached: true,
    stdio: "ignore",
    env: process.env,
  });
  child.unref();
  child.on("error", () => {});
  return child.pid;
}

export function daemonRunning(): boolean {
  return existsSync(daemonSockPath());
}

export interface DaemonResponse {
  ok: boolean;
  version?: string;
  error?: string;
  /** Hot-cache payload (T35) — shape depends on `kind`. */
  data?: unknown;
  /** True when the daemon served `data` straight from a hot cache. */
  cached?: boolean;
  kind?: string;
}

export function connectDaemon(
  cmd: string = "ping",
  payload?: Record<string, unknown>,
  timeoutMs: number = 1500,
): Promise<DaemonResponse | null> {
  return new Promise((resolve) => {
    if (isDaemonDisabled() || !daemonRunning()) {
      resolve(null);
      return;
    }
    const conn = net.connect({ path: daemonSockPath() });
    let settled = false;
    const finish = (resp: DaemonResponse | null): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      conn.destroy();
      resolve(resp);
    };
    const timeout = setTimeout(() => finish(null), timeoutMs);
    conn.on("connect", () => {
      conn.write(`${JSON.stringify({ cmd, version: DAEMON_VERSION, ...payload })}\n`);
    });
    let data = "";
    const parse = (line: string): DaemonResponse | null => {
      try {
        return JSON.parse(line) as DaemonResponse;
      } catch {
        return null;
      }
    };
    conn.on("data", (chunk) => {
      data += chunk.toString();
      // atd answers one JSON line per request and keeps the connection open for
      // the next one, so the first complete line IS the answer — waiting for
      // `close` here would time out on every call.
      const nl = data.indexOf("\n");
      if (nl >= 0) finish(parse(data.slice(0, nl)));
    });
    conn.on("close", () => {
      const rest = data.trim();
      finish(rest.length > 0 ? parse(rest.split("\n").pop() || "") : null);
    });
    conn.on("error", () => finish(null));
  });
}

export async function tryWithDaemon<T>(
  direct: () => T,
  daemonOp?: () => Promise<T>,
): Promise<T | { fallback: true; direct: T }> {
  if (isDaemonDisabled()) {
    return { fallback: true, direct: direct() };
  }
  if (!daemonRunning()) {
    try {
      spawnDaemon();
    } catch {
      // ignore spawn errors
    }
  }
  if (daemonOp) {
    try {
      const result = await daemonOp();
      return result;
    } catch {
      // fall through
    }
  }
  try {
    const ping = await connectDaemon("ping");
    if (ping?.ok) {
      if (daemonOp) {
        return await daemonOp();
      }
    }
  } catch {
    // fall through
  }
  return { fallback: true, direct: direct() };
}
