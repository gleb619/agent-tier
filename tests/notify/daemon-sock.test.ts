import { appendFileSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import net from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  brokerRunStore,
  connectDaemon,
  type DaemonRequest,
  type DaemonServer,
  daemonSockPath,
  emitViaDaemon,
  isDaemonUp,
  requestDaemon,
  startDaemonServer,
} from "../../src/notify/daemon-sock";
import { readEvents } from "../../src/notify/store";
import type { NotifyEvent } from "../../src/notify/types";

function event(over: Partial<NotifyEvent> = {}): NotifyEvent {
  return {
    runId: "r1",
    agent: "mock",
    ts: new Date().toISOString(),
    seq: 0,
    type: "message",
    text: "hello",
    ...over,
  };
}

/**
 * Transport-level suite: a stub daemon server stands in for `at serve --daemon`
 * so framing, connect-with-fallback, timeout and close semantics of
 * `src/notify/daemon-sock.ts` are covered without the real hub handlers.
 */
describe("daemon sock transport", () => {
  let stateDir: string;
  let server: DaemonServer | undefined;

  beforeEach(() => {
    stateDir = mkdtempSync(path.join(tmpdir(), "at-daemon-sock-"));
    delete process.env.AT_NO_DAEMON;
    delete process.env.AT_DEPTH;
  });

  afterEach(async () => {
    await server?.close();
    server = undefined;
    rmSync(stateDir, { recursive: true, force: true });
  });

  it("resolves the socket path under the state dir", () => {
    expect(daemonSockPath(stateDir)).toBe(path.join(stateDir, "daemon.sock"));
  });

  it("reports the daemon down when no socket file exists", async () => {
    expect(isDaemonUp(stateDir)).toBe(false);
    expect(await requestDaemon(stateDir, "ping", undefined, { timeoutMs: 200 })).toBeNull();
  });

  it("emit frame reaches the daemon, which persists it, and is answered with ok", async () => {
    const seen: DaemonRequest[] = [];
    server = await startDaemonServer({
      stateDir,
      handler: async (req) => {
        seen.push(req);
        if (req.op === "emit") {
          const e = req.payload as NotifyEvent;
          appendFileSync(path.join(stateDir, "raw-events.jsonl"), `${JSON.stringify(e)}\n`);
          return { stored: true, runId: e.runId };
        }
        return {};
      },
    });

    const res = await requestDaemon(stateDir, "emit", event(), { timeoutMs: 1000 });
    expect(res).not.toBeNull();
    expect(res?.ok).toBe(true);
    expect(res?.data).toMatchObject({ stored: true, runId: "r1" });
    expect(seen.map((r) => r.op)).toEqual(["emit"]);
    expect(JSON.parse(readFileSync(path.join(stateDir, "raw-events.jsonl"), "utf8").trim()).text).toBe("hello");
  });

  it("discuss frame is answered with ok and the daemon-assigned id", async () => {
    server = await startDaemonServer({
      stateDir,
      handler: async (req) => {
        if (req.op === "discuss") {
          const p = req.payload as { runId: string; kind: string; text: string };
          appendFileSync(path.join(stateDir, `${p.runId}.discuss.jsonl`), `${JSON.stringify(p)}\n`);
          return { id: "m1" };
        }
        return {};
      },
    });

    const res = await requestDaemon(
      stateDir,
      "discuss",
      { runId: "d1", from: "agent", kind: "note", text: "milestone" },
      { timeoutMs: 1000 },
    );
    expect(res?.ok).toBe(true);
    expect(res?.data).toMatchObject({ id: "m1" });
    expect(readFileSync(path.join(stateDir, "d1.discuss.jsonl"), "utf8")).toContain("milestone");
  });

  it("emitViaDaemon is true only when the daemon accepted the event", async () => {
    const received: NotifyEvent[] = [];
    server = await startDaemonServer({
      stateDir,
      handler: async (req) => {
        if (req.op === "emit") received.push(req.payload as NotifyEvent);
        return {};
      },
    });

    expect(await emitViaDaemon(stateDir, event({ text: "one" }))).toBe(true);
    expect(received).toHaveLength(1);
    expect(received[0].text).toBe("one");

    await server.close();
    server = undefined;
    expect(await emitViaDaemon(stateDir, event({ text: "two" }))).toBe(false);
  });

  it("answers an error frame when the handler throws", async () => {
    server = await startDaemonServer({
      stateDir,
      handler: async () => {
        throw new Error("handler blew up");
      },
    });

    const res = await requestDaemon(stateDir, "emit", event(), { timeoutMs: 1000 });
    expect(res).not.toBeNull();
    expect(res?.ok).toBe(false);
    expect(res?.error).toContain("handler blew up");
  });

  it("pipelines several frames over one connection and matches replies by id", async () => {
    server = await startDaemonServer({
      stateDir,
      handler: async (req) => ({ echo: req.op, n: (req.payload as { n: number }).n }),
    });

    const client = await connectDaemon(stateDir, { timeoutMs: 1000 });
    expect(client).not.toBeNull();

    const replies = await Promise.all([1, 2, 3, 4].map((n) => client!.request("emit", { n }, { timeoutMs: 1000 })));
    expect(replies.map((r) => r.data)).toEqual([
      { echo: "emit", n: 1 },
      { echo: "emit", n: 2 },
      { echo: "emit", n: 3 },
      { echo: "emit", n: 4 },
    ]);
    expect(new Set(replies.map((r) => r.id)).size).toBe(4);

    client!.close();
  });

  it("a closed connection settles pending requests instead of hanging", async () => {
    let release: (() => void) | undefined;
    server = await startDaemonServer({
      stateDir,
      handler: () => new Promise<void>((resolve) => (release = resolve)).then(() => ({})),
    });

    const client = await connectDaemon(stateDir, { timeoutMs: 5000 });
    expect(client).not.toBeNull();
    const pending = client!.request("emit", event(), { timeoutMs: 5000 });
    client!.close();
    release?.();

    await expect(pending).rejects.toThrow(/daemon/i);
  });

  it("request times out when the daemon never answers", async () => {
    server = await startDaemonServer({
      stateDir,
      handler: () => new Promise(() => {}),
    });

    const started = Date.now();
    const res = await requestDaemon(stateDir, "emit", event(), { timeoutMs: 250 });
    expect(res).toBeNull();
    expect(Date.now() - started).toBeLessThan(2000);
  });

  it("connect-with-fallback starts the daemon when the socket is missing", async () => {
    const stubs: net.Server[] = [];
    const spawn = vi.fn(async (dir: string) => {
      // Stand in for `at serve --daemon`: bring the socket up out-of-band.
      const stub = net.createServer();
      stubs.push(stub);
      stub.listen(daemonSockPath(dir));
    });

    try {
      const client = await connectDaemon(stateDir, { timeoutMs: 1000, spawn });
      expect(spawn).toHaveBeenCalledTimes(1);
      expect(client).not.toBeNull();
    } finally {
      for (const s of stubs) s.close();
    }
  });

  it("does not autostart when the daemon is disabled by env", async () => {
    process.env.AT_NO_DAEMON = "1";
    const spawn = vi.fn(async () => {});

    expect(isDaemonUp(stateDir)).toBe(false);
    expect(await connectDaemon(stateDir, { timeoutMs: 200, spawn })).toBeNull();
    expect(spawn).not.toHaveBeenCalled();
    expect(await requestDaemon(stateDir, "ping", undefined, { timeoutMs: 200 })).toBeNull();
  });

  it("treats a stale socket file as no daemon, but reuses a live one", async () => {
    writeFileSync(daemonSockPath(stateDir), "", "utf8");
    expect(existsSync(daemonSockPath(stateDir))).toBe(true);
    expect(await requestDaemon(stateDir, "emit", event(), { timeoutMs: 300 })).toBeNull();

    server = await startDaemonServer({ stateDir, handler: async () => ({ pong: true }) });
    const ping = await requestDaemon(stateDir, "ping", undefined, { timeoutMs: 500 });
    expect(ping?.ok).toBe(true);
    expect(ping?.data).toMatchObject({ pong: true });
  });

  it("brokerRunStore forwards runs.jsonl/state.json ops and reports failure", async () => {
    const ops: string[] = [];
    server = await startDaemonServer({
      stateDir,
      handler: async (req) => {
        ops.push(req.op);
        if (req.op === "runs.add") return { applied: true };
        throw new Error("nope");
      },
    });

    expect(await brokerRunStore(stateDir, "runs.add", { record: event() })).toMatchObject({
      ok: true,
      data: { applied: true },
    });
    expect(await brokerRunStore(stateDir, "runs.update", { runId: "r1" })).toBeNull();
    expect(ops).toEqual(["runs.add", "runs.update"]);
    expect(await brokerRunStore("/nonexistent-dir", "runs.add", {})).toBeNull();
  });

  it("removes the socket file on close so callers fall back to direct writes", async () => {
    const sock = daemonSockPath(stateDir);
    server = await startDaemonServer({ stateDir, handler: async () => ({}) });
    expect(existsSync(sock)).toBe(true);

    await server.close();
    server = undefined;
    expect(existsSync(sock)).toBe(false);
    expect(await emitViaDaemon(stateDir, event())).toBe(false);
  });
});

describe("daemon sock event store round-trip", () => {
  let stateDir: string;
  let server: DaemonServer | undefined;

  beforeEach(() => {
    stateDir = mkdtempSync(path.join(tmpdir(), "at-daemon-sock-store-"));
  });

  afterEach(async () => {
    await server?.close();
    server = undefined;
    rmSync(stateDir, { recursive: true, force: true });
  });

  it("daemon-written events are readable through the notify store", async () => {
    const { appendEvent } = await import("../../src/notify/store");
    server = await startDaemonServer({
      stateDir,
      handler: async (req) => {
        appendEvent(stateDir, req.payload as NotifyEvent);
        return {};
      },
    });

    expect(await emitViaDaemon(stateDir, event({ runId: "r9", seq: 1, type: "progress", text: "halfway" }))).toBe(true);

    const events = readEvents(stateDir, "r9");
    expect(events).toHaveLength(1);
    expect(events[0].text).toBe("halfway");
  });
});
