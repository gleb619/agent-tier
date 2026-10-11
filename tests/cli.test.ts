import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { computeHmac } from "../src/config";
import { isDeactivated, setDeactivated } from "../src/health";
import { formatInitResults, runInit } from "../src/init";
import { getRunsFile } from "../src/run-store";
import { runStatus } from "../src/status";

function mkdtemp(): string {
  const d = path.join(os.tmpdir(), `at-test-${Date.now()}-${Math.random()}`);
  fs.mkdirSync(d, { recursive: true });
  return d;
}

describe("signConfig", () => {
  // signConfig reads hardcoded CONFIG_FILE (~/.at/config.json),
  // so we test computeHmac directly and skip the full signConfig
  // (which writes to ~/.at/config.json.hmac). Integration test.

  it("computeHmac returns 64-char hex", () => {
    const hmac = computeHmac('{"tierOverrides":{}}');
    expect(hmac.length).toBe(64);
    expect(/^[a-f0-9]+$/.test(hmac)).toBe(true);
  });

  it("computeHmac is deterministic", () => {
    const data = '{"tierOverrides":{"kimi":1}}';
    expect(computeHmac(data)).toBe(computeHmac(data));
  });

  it("computeHmac differs for different inputs", () => {
    expect(computeHmac("a")).not.toBe(computeHmac("b"));
  });
});

describe("isDeactivated / setDeactivated", () => {
  let tmpDir: string;
  let stateFile: string;

  beforeEach(() => {
    tmpDir = mkdtemp();
    stateFile = path.join(tmpDir, "state.json");
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("isDeactivated returns false when no state", async () => {
    const result = await isDeactivated(stateFile, "pi");
    expect(result).toBe(false);
  });

  it("setDeactivated(true) creates state with deactivated flag", async () => {
    await setDeactivated(stateFile, "pi", true);
    const result = await isDeactivated(stateFile, "pi");
    expect(result).toBe(true);
  });

  it("setDeactivated(false) removes the flag", async () => {
    await setDeactivated(stateFile, "pi", true);
    await setDeactivated(stateFile, "pi", false);
    const result = await isDeactivated(stateFile, "pi");
    expect(result).toBe(false);
  });
});

describe("runStatus + formatInitResults", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtemp();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('runStatus: writes "no runs found" when runs.jsonl empty', async () => {
    fs.writeFileSync(getRunsFile(tmpDir), "", "utf8");
    let output = "";
    const orig = console.log;
    console.log = (...a: unknown[]) => {
      output += `${a.join(" ")}\n`;
    };
    try {
      await runStatus(tmpDir);
    } finally {
      console.log = orig;
    }
    expect(output).toContain("no runs found");
  });

  it("runStatus: outputs JSON when json:true", async () => {
    fs.writeFileSync(getRunsFile(tmpDir), "", "utf8");
    let output = "";
    const orig = process.stdout.write;
    process.stdout.write = (s) => {
      output += s;
      return true;
    };
    try {
      await runStatus(tmpDir, { json: true });
    } finally {
      process.stdout.write = orig;
    }
    expect(JSON.parse(output.trim())).toHaveProperty("runs");
  });

  it("runStatus: excludes TTL-expired runs from output and prunes file atomically", async () => {
    const runsFile = getRunsFile(tmpDir);
    const base = {
      agent: "mock",
      tier: 4,
      pid: 12345,
      prompt: "seeded",
      logFile: "/tmp/at-logs/seeded.log",
      exitCode: 0,
      status: "done" as const,
    };
    const stale = {
      ...base,
      runId: "stale-1",
      startedAt: new Date(Date.now() - 25 * 3600 * 1000).toISOString(),
      finishedAt: new Date(Date.now() - 25 * 3600 * 1000).toISOString(),
      name: "stale",
    };
    const fresh = {
      ...base,
      runId: "fresh-1",
      startedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
      name: "fresh",
    };
    fs.writeFileSync(runsFile, `${JSON.stringify(stale)}\n${JSON.stringify(fresh)}\n`, "utf8");

    let output = "";
    const orig = process.stdout.write;
    process.stdout.write = (s) => {
      output += s;
      return true;
    };
    try {
      await runStatus(tmpDir, { json: true });
    } finally {
      process.stdout.write = orig;
    }

    // Output must reflect the prune: expired run gone.
    const parsed = JSON.parse(output.trim()) as { total: number; runs: Array<{ runId: string }> };
    expect(parsed.total).toBe(1);
    expect(parsed.runs[0].runId).toBe("fresh-1");

    // File must match what was printed — one atomic locked write, no race.
    const onDisk = fs
      .readFileSync(runsFile, "utf8")
      .trim()
      .split("\n")
      .map((l) => (JSON.parse(l) as { runId: string }).runId);
    expect(onDisk).toEqual(["fresh-1"]);
  });

  it("formatInitResults: CREATED / SKIP / WOULD CREATE", () => {
    const out = formatInitResults([
      { agent: "x", targetPath: "/x", action: "created" as const },
      { agent: "y", targetPath: "/y", action: "skipped" as const, reason: "exists" },
      { agent: "z", targetPath: "/z", action: "would_create" as const },
    ]);
    expect(out).toContain("CREATED");
    expect(out).toContain("SKIP");
    expect(out).toContain("WOULD CREATE");
    expect(out).toContain("exists");
  });
});

describe("runInit", () => {
  it("list returns array of InitResult", () => {
    const results = runInit({ list: true });
    expect(Array.isArray(results)).toBe(true);
    results.forEach((r) => {
      expect(typeof r.agent).toBe("string");
    });
  });

  it("throws for non-existent agent", () => {
    expect(() => runInit({ agent: "nonexistent-agent-xyz" })).toThrow();
  });
});
