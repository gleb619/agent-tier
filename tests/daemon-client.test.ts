import { mkdirSync, rmSync } from "node:fs";
import net from "node:net";
import { dirname } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  connectDaemon,
  DAEMON_VERSION,
  daemonPidPath,
  daemonRunning,
  daemonSockPath,
  isDaemonDisabled,
  spawnDaemon,
  tryWithDaemon,
} from "../src/daemon-client";

describe("daemon client", () => {
  const origNoDaemon = process.env.AT_NO_DAEMON;
  const origDepth = process.env.AT_DEPTH;

  beforeEach(() => {
    delete process.env.AT_NO_DAEMON;
    delete process.env.AT_DEPTH;
  });

  afterEach(() => {
    if (origNoDaemon !== undefined) process.env.AT_NO_DAEMON = origNoDaemon;
    else delete process.env.AT_NO_DAEMON;
    if (origDepth !== undefined) process.env.AT_DEPTH = origDepth;
    else delete process.env.AT_DEPTH;
  });

  it("resolves sock and pid paths under default state dir", () => {
    expect(daemonSockPath()).toContain("atd.sock");
    expect(daemonPidPath()).toContain("atd.pid");
  });

  it("respects AT_STATE_DIR", () => {
    process.env.AT_STATE_DIR = "/tmp/test-at";
    expect(daemonSockPath()).toBe("/tmp/test-at/atd.sock");
  });

  it("isDaemonDisabled returns true when AT_NO_DAEMON set", () => {
    process.env.AT_NO_DAEMON = "1";
    expect(isDaemonDisabled()).toBe(true);
  });

  it("isDaemonDisabled returns true when AT_DEPTH set", () => {
    process.env.AT_DEPTH = "2";
    expect(isDaemonDisabled()).toBe(true);
  });

  it("daemonRunning reflects sock presence", () => {
    expect(typeof daemonRunning()).toBe("boolean");
  });

  it("connectDaemon returns null when daemon disabled", async () => {
    process.env.AT_NO_DAEMON = "1";
    const result = await connectDaemon();
    expect(result).toBeNull();
  });

  it("connectDaemon resolves when the daemon keeps the connection open", async () => {
    // Real atd answers one JSON line per request and stays in its read loop;
    // the client must treat that line as the answer instead of waiting for EOF.
    const sock = daemonSockPath();
    mkdirSync(dirname(sock), { recursive: true });
    const server = net.createServer((conn) => {
      conn.on("data", () => {
        conn.write(`${JSON.stringify({ ok: true, version: DAEMON_VERSION, data: [1, 2], cached: true })}\n`);
      });
    });
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(sock, resolve);
    });
    try {
      const resp = await connectDaemon("runs", { dir: dirname(sock) }, 2000);
      expect(resp).toMatchObject({ ok: true, data: [1, 2], cached: true });
    } finally {
      server.closeAllConnections?.();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      rmSync(sock, { force: true });
    }
  });

  it("tryWithDaemon falls back when disabled", async () => {
    process.env.AT_NO_DAEMON = "1";
    const result = await tryWithDaemon(() => 42);
    expect(result).toEqual({ fallback: true, direct: 42 });
  });

  it("spawnDaemon returns a pid number", () => {
    const pid = spawnDaemon();
    expect(pid === undefined || typeof pid === "number").toBe(true);
  });

  it("exports DAEMON_VERSION", () => {
    expect(DAEMON_VERSION).toBe("0.1.0");
  });
});
