import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Command } from "commander";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { registerNotifyCommand } from "../../src/commands/notify";
import { startHub } from "../../src/notify/hub";

describe("at notify command (alias for discuss note)", () => {
  let tmp: string;
  let stateDir: string;
  let hub: Awaited<ReturnType<typeof startHub>> | undefined;
  const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => undefined as never);

  beforeEach(() => {
    tmp = mkdtempSync(path.join(tmpdir(), "at-notify-cmd-"));
    stateDir = tmp;
    exitSpy.mockClear();
    process.env.AT_STATE_DIR = stateDir;
  });

  afterEach(async () => {
    await hub?.close();
    delete process.env.AT_SSE_URL;
    delete process.env.AT_EVENT_FILE;
    delete process.env.AT_STATE_DIR;
    rmSync(tmp, { recursive: true, force: true });
  });

  async function runNotify(args: string[]): Promise<void> {
    const program = new Command();
    registerNotifyCommand(program);
    await program.parseAsync(["node", "at", "notify", ...args]);
  }

  it("writes a note entry to <runId>.discuss.jsonl when no hub", async () => {
    delete process.env.AT_SSE_URL;
    await runNotify(["run-x", "hello", "world"]);
    const file = path.join(stateDir, "events", "run-x.discuss.jsonl");
    const lines = readFileSync(file, "utf8").trim().split("\n");
    expect(lines).toHaveLength(1);
    const ev = JSON.parse(lines[0]);
    expect(ev.from).toBe("agent");
    expect(ev.kind).toBe("note");
    expect(ev.text).toBe("hello world");
  });

  it("POSTs note to hub when AT_SSE_URL set; hub mirrors to SSE + .discuss.jsonl", async () => {
    hub = await startHub({ stateDir, port: 0 });
    process.env.AT_SSE_URL = `http://127.0.0.1:${hub.port}`;
    await runNotify(["run-y", "via hub"]);

    await new Promise((r) => setTimeout(r, 200));
    const file = path.join(stateDir, "events", "run-y.discuss.jsonl");
    const lines = readFileSync(file, "utf8").trim().split("\n");
    expect(lines.length).toBeGreaterThanOrEqual(1);
    const ev = JSON.parse(lines[0]);
    expect(ev.kind).toBe("note");
    expect(ev.text).toBe("via hub");
  });
});
