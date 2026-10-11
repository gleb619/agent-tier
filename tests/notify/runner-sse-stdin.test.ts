import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AgentDef } from "../../src/agents/registry";
import { readEvents } from "../../src/notify/store";
import type { RunOptions } from "../../src/resolver";
import { closeProcessHub, defaultSpawner } from "../../src/runner";

/**
 * Validates that the SSE path correctly pipes `prompt + promptSuffix`
 * to agents with `promptMode: 'stdin'` (e.g. agy). The mock agent
 * writes the stdin it received to a sentinel file; we assert the
 * sentinel file contains both the prompt and the appended suffix.
 */
describe("runner sse stdin (agy-style agents)", () => {
  let tmp: string;
  let stateDir: string;
  let logDir: string;
  let script: string;
  let stdinCapture: string;

  beforeEach(() => {
    tmp = mkdtempSync(path.join(tmpdir(), "at-runner-stdin-"));
    stateDir = path.join(tmp, "state");
    logDir = path.join(tmp, "logs");
    stdinCapture = path.join(tmp, "stdin.txt");
    // Read all stdin, write to sentinel, then exit 0.
    script = path.join(tmp, "agent-stdin.js");
    writeFileSync(
      script,
      `#!/usr/bin/env node\n` +
        `const fs = require('fs');\n` +
        `let buf = '';\n` +
        `process.stdin.setEncoding('utf8');\n` +
        `process.stdin.on('data', (c) => { buf += c; });\n` +
        `process.stdin.on('end', () => {\n` +
        `  fs.writeFileSync(${JSON.stringify(stdinCapture)}, buf);\n` +
        `  process.stdout.write('done\\n');\n` +
        `  process.exit(0);\n` +
        `});\n`,
    );
    chmodSync(script, 0o755);
  });

  afterEach(async () => {
    await closeProcessHub();
    rmSync(tmp, { recursive: true, force: true });
  });

  function makeAgent(): AgentDef {
    return {
      name: "agy",
      tier: 3,
      bin: () => script,
      buildArgs: () => ["--yolo", "--skip-trust"],
      promptMode: "stdin",
    };
  }

  function options(): RunOptions {
    return {
      agent: "agy",
      tier: 3,
      prompt: "fix the bug",
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

  it("pipes prompt + promptSuffix to stdin under SSE", async () => {
    const agent = makeAgent();
    const opts = options();
    const exitCode = await defaultSpawner(agent, opts);
    expect(exitCode).toBe(0);

    // SSE events were published
    const _events = readEvents(stateDir, expect.anything() as unknown as string);
    // Find the run via the event file matching runId in the events dir
    const { readdirSync } = await import("node:fs");
    const dir = path.join(stateDir, "events");
    const files = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith(".jsonl")) : [];
    expect(files.length).toBeGreaterThan(0);
    const runId = files[0]!.replace(/\.jsonl$/, "");
    const evs = readEvents(stateDir, runId);
    expect(evs.map((e) => e.type)).toEqual(expect.arrayContaining(["start", "message", "done"]));

    // stdin received both prompt and the log-adapter's promptSuffix
    expect(existsSync(stdinCapture)).toBe(true);
    const received = readFileSync(stdinCapture, "utf8");
    expect(received).toContain("fix the bug");
    expect(received).toContain("at notify");
    expect(received).toContain(runId);
  });
});
