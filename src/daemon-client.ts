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
}

export function connectDaemon(cmd: string = "ping", payload?: Record<string, unknown>): Promise<DaemonResponse | null> {
  return new Promise((resolve) => {
    if (isDaemonDisabled() || !daemonRunning()) {
      resolve(null);
      return;
    }
    const conn = net.connect({ path: daemonSockPath() });
    const timeout = setTimeout(() => {
      conn.destroy();
      resolve(null);
    }, 1500);
    conn.on("connect", () => {
      conn.write(`${JSON.stringify({ cmd, version: DAEMON_VERSION, ...payload })}\n`);
    });
    let data = "";
    conn.on("data", (chunk) => {
      data += chunk.toString();
    });
    conn.on("close", () => {
      clearTimeout(timeout);
      try {
        const resp = JSON.parse(data.trim().split("\n").pop() || "{}");
        resolve(resp as DaemonResponse);
      } catch {
        resolve(null);
      }
    });
    conn.on("error", () => {
      clearTimeout(timeout);
      conn.destroy();
      resolve(null);
    });
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
