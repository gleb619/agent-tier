import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { Command } from "commander";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildAgentsReport } from "../../src/agents/report";
import { registerAgentsCommand } from "../../src/commands/agents";

describe("buildAgentsReport", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "at-agents-report-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("lists registry agents with health defaults on empty state", () => {
    const report = buildAgentsReport([tmpDir]);
    expect(Array.isArray(report)).toBe(true);
    const names = report.map((a) => a.name);
    expect(names).toContain("glm-code");
    expect(names).toContain("mock");
    for (const a of report) {
      expect(typeof a.tier).toBe("number");
      expect(a).toHaveProperty("deactivated");
      expect(a).toHaveProperty("failures");
      expect(a).toHaveProperty("lastFailure");
      expect(a).toHaveProperty("disabledTo");
    }
  });

  it("reflects deactivated agents from state.json health", () => {
    fs.writeFileSync(
      path.join(tmpDir, "state.json"),
      JSON.stringify({ agents: { mock: { failureTimes: [], disabledTo: null, deactivated: true } } }),
    );
    const report = buildAgentsReport([tmpDir]);
    const mock = report.find((a) => a.name === "mock")!;
    expect(mock.deactivated).toBe(true);
    const codex = report.find((a) => a.name === "codex")!;
    expect(codex.deactivated).toBe(false);
  });
});

describe("registerAgentsCommand", () => {
  let tmpDir: string;
  const originalStateDir = process.env.AT_STATE_DIR;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "at-agents-cmd-"));
    fs.writeFileSync(path.join(tmpDir, "state.json"), '{"scheduler":{},"agents":{}}');
    process.env.AT_STATE_DIR = tmpDir;
  });

  afterEach(() => {
    if (originalStateDir === undefined) delete process.env.AT_STATE_DIR;
    else process.env.AT_STATE_DIR = originalStateDir;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function runRegistered(args: string[]): string {
    const program = new Command();
    program.exitOverride();
    registerAgentsCommand(program);

    const stdoutChunks: string[] = [];
    const origWrite = process.stdout.write.bind(process.stdout);
    const origLog = console.log.bind(console);
    (process.stdout.write as unknown) = (chunk: string | Buffer): boolean => {
      stdoutChunks.push(typeof chunk === "string" ? chunk : chunk.toString());
      return true;
    };
    console.log = (...parts: unknown[]) => {
      stdoutChunks.push(parts.map((p) => (typeof p === "string" ? p : String(p))).join(" "));
    };

    try {
      return Promise.resolve(program.parseAsync(["node", "at", ...args]))
        .catch(() => undefined)
        .then(() => {
          (process.stdout.write as unknown) = origWrite;
          console.log = origLog;
          return stdoutChunks.join("");
        });
    } catch {
      (process.stdout.write as unknown) = origWrite;
      console.log = origLog;
      return stdoutChunks.join("");
    }
  }

  it("--json prints the registry+health payload as JSON", async () => {
    const out = await runRegistered(["agents", "--json"]);
    const parsed = JSON.parse(out) as Array<{ name: string; tier: number; deactivated: boolean }>;
    expect(parsed.map((a) => a.name)).toContain("mock");
    const mock = parsed.find((a) => a.name === "mock")!;
    expect(mock.tier).toBe(4);
    expect(mock.deactivated).toBe(false);
  });

  it("deactivated state shows up in --json output", async () => {
    fs.writeFileSync(
      path.join(tmpDir, "state.json"),
      JSON.stringify({ agents: { mock: { failureTimes: [], disabledTo: null, deactivated: true } } }),
    );
    const out = await runRegistered(["agents", "--json"]);
    const parsed = JSON.parse(out) as Array<{ name: string; deactivated: boolean }>;
    expect(parsed.find((a) => a.name === "mock")!.deactivated).toBe(true);
  });

  it("text mode prints a human-readable table, not JSON", async () => {
    const out = await runRegistered(["agents"]);
    expect(out).not.toMatch(/^\s*\[/);
    expect(out).toContain("mock");
  });
});
