import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import http from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { startHub } from "../../src/notify/hub";

describe("notify hub", () => {
  let stateDir: string;
  let hub: Awaited<ReturnType<typeof startHub>>;

  beforeEach(() => {
    stateDir = mkdtempSync(path.join(tmpdir(), "at-hub-"));
  });

  afterEach(async () => {
    await hub?.close();
    rmSync(stateDir, { recursive: true, force: true });
  });

  function collect(urlPath: string, lastEventId?: string): Promise<{ lines: string[]; events: unknown[] }> {
    return new Promise((resolve, reject) => {
      const headers: Record<string, string> = { Accept: "text/event-stream" };
      if (lastEventId) headers["Last-Event-ID"] = lastEventId;
      const req = http.get(`http://127.0.0.1:${hub.port}${urlPath}`, { headers }, (res) => {
        const lines: string[] = [];
        let buffer = "";
        res.on("data", (chunk: Buffer) => {
          buffer += chunk.toString();
          const parts = buffer.split("\n\n");
          buffer = parts.pop() ?? "";
          for (const part of parts) {
            if (!part.trim()) continue;
            lines.push(part);
          }
        });
        setTimeout(() => {
          const events = lines
            .map((block) => {
              const dataLine = block.split("\n").find((l) => l.startsWith("data:"));
              return dataLine ? JSON.parse(dataLine.slice(5)) : null;
            })
            .filter(Boolean);
          res.destroy();
          resolve({ lines, events });
        }, 400);
      });
      req.on("error", reject);
    });
  }

  it("replays stored events and broadcasts live", async () => {
    hub = await startHub({ stateDir, port: 0 });
    hub.publish({ runId: "r1", agent: "a", ts: new Date().toISOString(), seq: 0, type: "start" });
    hub.publish({ runId: "r1", agent: "a", ts: new Date().toISOString(), seq: 0, type: "message", text: "one" });

    const { events } = await collect("/events/r1");
    expect(events).toHaveLength(2);
    expect((events[0] as { type: string }).type).toBe("start");
    expect((events[1] as { text: string }).text).toBe("one");
  });

  it("POST /emit stores and broadcasts", async () => {
    hub = await startHub({ stateDir, port: 0 });
    const res = await fetch(`http://127.0.0.1:${hub.port}/emit/r2`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "progress", text: "halfway" }),
    });
    expect(res.status).toBe(202);

    const { events } = await collect("/events/r2");
    expect(events).toHaveLength(1);
    expect((events[0] as { type: string; text: string }).text).toBe("halfway");
  });

  it("supports Last-Event-ID resume", async () => {
    hub = await startHub({ stateDir, port: 0 });
    hub.publish({ runId: "r3", agent: "a", ts: new Date().toISOString(), seq: 0, type: "message", text: "a" });
    hub.publish({ runId: "r3", agent: "a", ts: new Date().toISOString(), seq: 0, type: "message", text: "b" });
    hub.publish({ runId: "r3", agent: "a", ts: new Date().toISOString(), seq: 0, type: "message", text: "c" });

    const { events } = await collect("/events/r3", "1");
    expect(events.map((e: unknown) => (e as { text: string }).text)).toEqual(["b", "c"]);
  });

  it("close() resolves promptly even with an open SSE connection", async () => {
    hub = await startHub({ stateDir, port: 0 });

    // Hold a long-lived SSE connection.
    const req = http.get(`http://127.0.0.1:${hub.port}/events/close-test`, {
      headers: { Accept: "text/event-stream" },
    });
    await new Promise<void>((resolve) => req.once("response", () => resolve()));
    await new Promise((r) => setTimeout(r, 50)); // let hub register the client

    const closeStart = Date.now();
    await hub.close();
    const closeMs = Date.now() - closeStart;

    expect(closeMs).toBeLessThan(1500);

    req.destroy();
    hub = undefined;
  });

  it("falls back to a random port when the requested port is busy", async () => {
    const blocker = http.createServer();
    await new Promise<void>((resolve) => blocker.listen(0, "127.0.0.1", resolve));
    const blockerPort = (blocker.address() as { port: number }).port;

    const warnings: string[] = [];
    hub = await startHub({
      stateDir,
      port: blockerPort,
      warn: (m) => warnings.push(m),
    });

    // Falls back to a different port (the OS-assigned one).
    expect(hub.port).not.toBe(blockerPort);
    expect(hub.port).toBeGreaterThan(0);
    expect(hub.requestedPort).toBe(blockerPort);
    expect(warnings.some((w) => w.includes("busy") && w.includes(String(blockerPort)))).toBe(true);

    await new Promise<void>((resolve) => blocker.close(() => resolve()));
    hub = undefined;
  });

  it("does not warn when the requested port is 0 (random from the start)", async () => {
    const warnings: string[] = [];
    hub = await startHub({
      stateDir,
      port: 0,
      warn: (m) => warnings.push(m),
    });
    expect(hub.port).toBeGreaterThan(0);
    expect(warnings).toEqual([]);
    hub = undefined;
  });
});

describe("notify hub /discuss endpoints", () => {
  let stateDir: string;
  let hub: Awaited<ReturnType<typeof startHub>>;

  beforeEach(() => {
    stateDir = mkdtempSync(path.join(tmpdir(), "at-hub-discuss-"));
  });

  afterEach(async () => {
    await hub?.close();
    rmSync(stateDir, { recursive: true, force: true });
  });

  it("POST /discuss appends to .discuss.jsonl and returns id", async () => {
    hub = await startHub({ stateDir, port: 0 });
    const res = await fetch(`http://127.0.0.1:${hub.port}/discuss/d-run`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ from: "agent", kind: "question", text: "ship?", options: ["yes", "no"] }),
    });
    expect(res.status).toBe(202);
    const json = (await res.json()) as { id: string };
    expect(json.id).toBe("m1");
    const file = path.join(stateDir, "events", "d-run.discuss.jsonl");
    const lines = readFileSync(file, "utf8").trim().split("\n");
    expect(lines).toHaveLength(1);
    const ev = JSON.parse(lines[0]);
    expect(ev).toMatchObject({ id: "m1", from: "agent", kind: "question", text: "ship?" });
    expect(ev.options).toEqual(["yes", "no"]);
  });

  it("GET /discuss returns thread JSON", async () => {
    hub = await startHub({ stateDir, port: 0 });
    await fetch(`http://127.0.0.1:${hub.port}/discuss/d-thread`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ from: "agent", kind: "question", text: "q" }),
    });
    await fetch(`http://127.0.0.1:${hub.port}/discuss/d-thread`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ from: "host", kind: "answer", text: "a", replyTo: "m1" }),
    });

    const res = await fetch(`http://127.0.0.1:${hub.port}/discuss/d-thread`);
    const list = (await res.json()) as Array<Record<string, unknown>>;
    expect(list).toHaveLength(2);
    expect(list[0]).toMatchObject({ id: "m1", kind: "question" });
    expect(list[1]).toMatchObject({ id: "m2", kind: "answer", replyTo: "m1" });
  });

  it("GET /discuss?pending=1 returns only unanswered questions", async () => {
    hub = await startHub({ stateDir, port: 0 });
    await fetch(`http://127.0.0.1:${hub.port}/discuss/d-pend`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ from: "agent", kind: "question", text: "q1" }),
    });
    await fetch(`http://127.0.0.1:${hub.port}/discuss/d-pend`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ from: "agent", kind: "question", text: "q2" }),
    });
    await fetch(`http://127.0.0.1:${hub.port}/discuss/d-pend`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ from: "host", kind: "answer", text: "a1", replyTo: "m1" }),
    });

    const res = await fetch(`http://127.0.0.1:${hub.port}/discuss/d-pend?pending=1`);
    const list = (await res.json()) as Array<Record<string, unknown>>;
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ id: "m2", kind: "question" });
  });

  it("POST /discuss with bad payload returns 400", async () => {
    hub = await startHub({ stateDir, port: 0 });
    const res = await fetch(`http://127.0.0.1:${hub.port}/discuss/d-bad`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind: "nonsense" }),
    });
    expect(res.status).toBe(400);
  });

  it("POST /discuss mirrors as SSE event (question / answer / message)", async () => {
    hub = await startHub({ stateDir, port: 0 });
    // Collect SSE events
    const collected: Array<Record<string, unknown>> = [];
    const sseReq = http.get(`http://127.0.0.1:${hub.port}/events/d-mirror`, () => {});
    sseReq.resume?.();
    sseReq.on("response", (clientRes) => {
      let buf = "";
      clientRes.on("data", (chunk: Buffer) => {
        buf += chunk.toString();
        const parts = buf.split("\n\n");
        buf = parts.pop() ?? "";
        for (const p of parts) {
          const dataLine = p.split("\n").find((l) => l.startsWith("data:"));
          if (dataLine) collected.push(JSON.parse(dataLine.slice(5)));
        }
      });
    });
    // wait for SSE to register
    await new Promise((r) => setTimeout(r, 100));

    await fetch(`http://127.0.0.1:${hub.port}/discuss/d-mirror`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ from: "agent", kind: "question", text: "q" }),
    });
    await fetch(`http://127.0.0.1:${hub.port}/discuss/d-mirror`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ from: "host", kind: "answer", text: "a", replyTo: "m1" }),
    });
    await fetch(`http://127.0.0.1:${hub.port}/discuss/d-mirror`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ from: "agent", kind: "note", text: "n" }),
    });

    await new Promise((r) => setTimeout(r, 200));
    sseReq.destroy();
    const types = collected.map((e) => e.type);
    expect(types).toContain("question");
    expect(types).toContain("answer");
    expect(types).toContain("message");
  });
});
