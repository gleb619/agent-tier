import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import http from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AgentDef } from "../../src/agents/registry";
import type { NotifyEvent } from "../../src/notify";
import { readEvents } from "../../src/notify/store";
import type { RunOptions } from "../../src/resolver";
import { closeProcessHub, defaultSpawner, getProcessHub } from "../../src/runner";

/**
 * End-to-end: real http hub on port 0, raw SSE client over /events/<runId>,
 * plus a parallel `POST /emit/<runId>` to simulate `at notify` posting
 * a progress event from inside the agent.
 *
 * The mock agent writes a few stdout lines, then exits 0. The log adapter
 * (default fallback for mock) consumes those lines as 'message' events,
 * giving us ≥1 message before the final 'done'.
 */
describe("notify e2e (mock agent + http hub + sse client)", () => {
  let tmp: string;
  let stateDir: string;
  let logDir: string;
  let script: string;

  beforeEach(() => {
    tmp = mkdtempSync(path.join(tmpdir(), "at-e2e-"));
    stateDir = path.join(tmp, "state");
    logDir = path.join(tmp, "logs");
    script = path.join(tmp, "mock-agent.js");
    writeFileSync(
      script,
      `#!/usr/bin/env node\n` +
        `console.log('starting mock agent');\n` +
        `console.log('working on task');\n` +
        `console.log('almost done');\n` +
        `process.exit(0);\n`,
    );
    chmodSync(script, 0o755);
  });

  afterEach(async () => {
    await closeProcessHub();
    rmSync(tmp, { recursive: true, force: true });
  });

  function makeAgent(): AgentDef {
    return {
      name: "mock",
      tier: 4,
      bin: () => script,
      buildArgs: (prompt) => [prompt],
    };
  }

  function options(): RunOptions {
    return {
      agent: "mock",
      tier: 4,
      prompt: "e2e test prompt",
      stream: false,
      stateDir,
      retries: 0,
      logDir,
      noChop: true,
      timeout: 10000,
      sse: true,
      ssePort: 0,
    };
  }

  /** Minimal SSE HTTP client: collects events until the 'done' event arrives. */
  function openSse(url: string): Promise<NotifyEvent[]> {
    return new Promise((resolve, reject) => {
      const events: NotifyEvent[] = [];
      const req = http.get(url, (res) => {
        if (res.statusCode !== 200) {
          reject(new Error(`SSE returned ${res.statusCode}`));
          return;
        }
        let buf = "";
        res.setEncoding("utf8");
        res.on("data", (chunk: string) => {
          buf += chunk;
          // SSE messages are separated by "\n\n"
          let idx = buf.indexOf("\n\n");
          while (idx !== -1) {
            const block = buf.slice(0, idx);
            buf = buf.slice(idx + 2);
            const ev = parseSseBlock(block);
            if (ev) {
              events.push(ev);
              if (ev.type === "done") {
                res.destroy();
                resolve(events);
                return;
              }
            }
            idx = buf.indexOf("\n\n");
          }
        });
        res.on("error", reject);
      });
      req.on("error", reject);
      req.setTimeout(15000, () => reject(new Error("SSE timeout")));
    });
  }

  function parseSseBlock(block: string): NotifyEvent | null {
    const lines = block.split("\n");
    let data: string | undefined;
    for (const line of lines) {
      if (line.startsWith("data: ")) data = line.slice(6);
    }
    if (!data) return null;
    try {
      return JSON.parse(data) as NotifyEvent;
    } catch {
      return null;
    }
  }

  /** POST a 'message' event to /emit/<runId> — mirrors `at notify <runId> "..."`. */
  function postEmit(port: number, runId: string, text: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const body = JSON.stringify({ type: "message", text });
      const req = http.request(
        {
          host: "127.0.0.1",
          port,
          path: `/emit/${encodeURIComponent(runId)}`,
          method: "POST",
          headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) },
        },
        (res) => {
          res.resume();
          if (res.statusCode === 202) resolve();
          else reject(new Error(`emit status ${res.statusCode}`));
        },
      );
      req.on("error", reject);
      req.write(body);
      req.end();
    });
  }

  it("streams start, message(s), and done to a connected SSE client", async () => {
    const agent = makeAgent();
    const opts = options();
    const exitCode = await defaultSpawner(agent, opts);
    expect(exitCode).toBe(0);

    // Resolve hub port + the runId used for this run
    const hub = await getProcessHub(opts);
    const { readdirSync, existsSync } = await import("node:fs");
    const dir = path.join(stateDir, "events");
    const files = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith(".jsonl")) : [];
    expect(files.length).toBe(1);
    const runId = files[0]!.replace(/\.jsonl$/, "");

    // Open SSE client. Subscribe AFTER the run finished; the hub replays
    // persisted events (the file store survives process exit because the
    // hub stays alive across the singleton).
    const events = await openSse(`http://127.0.0.1:${hub.port}/events/${runId}`);
    const types = events.map((e) => e.type);
    // start is first; ≥1 message must appear in the stream (before OR after
    // done — the log adapter may flush a final buffered message after the
    // runner publishes 'done'). A 'done' event must also be present and
    // carry status='done'.
    expect(types[0]).toBe("start");
    expect(types.filter((t) => t === "message").length).toBeGreaterThanOrEqual(1);
    expect(types).toContain("done");
    const done = events.find((e) => e.type === "done")!;
    expect(done.data).toBeDefined();
    expect((done.data as { status?: string }).status).toBe("done");

    // File store agrees with what the client saw
    const fileEvents = readEvents(stateDir, runId);
    expect(fileEvents.length).toBe(events.length);

    // POST /emit/<runId> shows up in subsequent SSE replay
    await postEmit(hub.port, runId, "manual progress update");
    const events2 = await openSse(`http://127.0.0.1:${hub.port}/events/${runId}`);
    const texts = events2.map((e) => e.text ?? "");
    expect(texts).toContain("manual progress update");
    const manual = events2.find((e) => e.text === "manual progress update");
    expect(manual).toBeDefined();
    expect(manual!.type).toBe("message");
  });
});
