import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { AgentDef } from "../src/agents/registry";
import {
  filterHealthy,
  isDeactivated,
  isHealthy,
  loadHealth,
  recordResult,
  resetAgent,
  saveHealth,
  setDeactivated,
} from "../src/health";

function makeAgent(name: string): AgentDef {
  return { name, tier: 2, bin: () => `/usr/bin/${name}`, buildArgs: (p) => [p] };
}

describe("loadHealth", () => {
  let stateDir: string;
  let stateFile: string;

  beforeEach(() => {
    stateDir = path.join(os.tmpdir(), `at-health-test-${Date.now()}`);
    stateFile = path.join(stateDir, "state.json");
  });

  afterEach(() => {
    if (fs.existsSync(stateFile)) fs.unlinkSync(stateFile);
    try {
      fs.rmdirSync(stateDir);
    } catch {
      /* not empty */
    }
  });

  it("returns empty {agents:{}} when file missing", () => {
    const result = loadHealth(stateFile);
    expect(result).toEqual({ agents: {} });
  });

  it("returns parsed content when file exists", () => {
    fs.mkdirSync(stateDir, { recursive: true });
    fs.writeFileSync(stateFile, JSON.stringify({ agents: { foo: { failureTimes: [], disabledTo: null } } }), "utf8");
    const result = loadHealth(stateFile);
    expect(result.agents.foo).toEqual({ failureTimes: [], disabledTo: null });
  });

  it("returns empty {agents:{}} on malformed JSON", () => {
    fs.mkdirSync(stateDir, { recursive: true });
    fs.writeFileSync(stateFile, "{not valid json", "utf8");
    const result = loadHealth(stateFile);
    expect(result).toEqual({ agents: {} });
  });
});

describe("saveHealth", () => {
  let stateDir: string;
  let stateFile: string;

  beforeEach(() => {
    stateDir = path.join(os.tmpdir(), `at-health-test-${Date.now()}`);
    stateFile = path.join(stateDir, "state.json");
  });

  afterEach(() => {
    if (fs.existsSync(stateFile)) fs.unlinkSync(stateFile);
    try {
      fs.rmdirSync(stateDir);
    } catch {
      /* not empty */
    }
  });

  it("writes valid JSON to file", () => {
    saveHealth(stateFile, { agents: { bar: { failureTimes: [], disabledTo: null } } });
    const content = fs.readFileSync(stateFile, "utf8");
    const parsed = JSON.parse(content);
    expect(parsed.agents.bar).toEqual({ failureTimes: [], disabledTo: null });
  });

  it("creates dir if missing", () => {
    expect(fs.existsSync(stateDir)).toBe(false);
    saveHealth(stateFile, { agents: {} });
    expect(fs.existsSync(stateDir)).toBe(true);
    expect(fs.existsSync(stateFile)).toBe(true);
  });
});

describe("recordResult", () => {
  let stateDir: string;
  let stateFile: string;

  beforeEach(() => {
    stateDir = path.join(os.tmpdir(), `at-health-test-${Date.now()}`);
    stateFile = path.join(stateDir, "state.json");
    fs.mkdirSync(stateDir, { recursive: true });
  });

  afterEach(() => {
    if (fs.existsSync(stateFile)) fs.unlinkSync(stateFile);
    try {
      fs.rmdirSync(stateDir);
    } catch {
      /* not empty */
    }
  });

  it("success path clears failureTimes and disabledTo", async () => {
    // Pre-populate with failures - use timestamp outside the 60min window
    const oldTime = new Date(Date.now() - 120 * 60 * 1000).toISOString();
    fs.writeFileSync(
      stateFile,
      JSON.stringify({
        agents: { agent1: { failureTimes: [oldTime], disabledTo: new Date(Date.now() + 60000).toISOString() } },
      }),
      "utf8",
    );

    await recordResult(stateFile, "agent1", true);
    const state = loadHealth(stateFile);
    expect(state.agents.agent1.failureTimes).toEqual([]);
    expect(state.agents.agent1.disabledTo).toBeNull();
  });

  it("failure path appends timestamp to failureTimes", async () => {
    await recordResult(stateFile, "agent1", false);
    const state = loadHealth(stateFile);
    expect(state.agents.agent1.failureTimes).toHaveLength(1);
    expect(new Date(state.agents.agent1.failureTimes[0]).getTime()).toBeLessThanOrEqual(Date.now());
  });

  it("failure path sets disabledTo based on failure count", async () => {
    // Record enough failures to trigger block (threshold is 3)
    await recordResult(stateFile, "agent1", false);
    await recordResult(stateFile, "agent1", false);
    await recordResult(stateFile, "agent1", false);

    const state = loadHealth(stateFile);
    expect(state.agents.agent1.disabledTo).not.toBeNull();
    const disabledTime = new Date(state.agents.agent1.disabledTo!).getTime();
    expect(disabledTime).toBeGreaterThan(Date.now());
  });
});

describe("isHealthy", () => {
  let stateDir: string;
  let stateFile: string;

  beforeEach(() => {
    stateDir = path.join(os.tmpdir(), `at-health-test-${Date.now()}`);
    stateFile = path.join(stateDir, "state.json");
    fs.mkdirSync(stateDir, { recursive: true });
  });

  afterEach(() => {
    if (fs.existsSync(stateFile)) fs.unlinkSync(stateFile);
    try {
      fs.rmdirSync(stateDir);
    } catch {
      /* not empty */
    }
  });

  it("returns true when no entry", async () => {
    const result = await isHealthy(stateFile, "unknown");
    expect(result).toBe(true);
  });

  it("returns true when no failures", async () => {
    fs.writeFileSync(stateFile, JSON.stringify({ agents: { agent1: { failureTimes: [], disabledTo: null } } }), "utf8");
    const result = await isHealthy(stateFile, "agent1");
    expect(result).toBe(true);
  });

  it("returns false when disabledTo is in the future", async () => {
    const futureTime = new Date(Date.now() + 60000).toISOString();
    // Use a recent failure time so it doesn't get pruned
    const recentTime = new Date(Date.now() - 1000).toISOString();
    fs.writeFileSync(
      stateFile,
      JSON.stringify({ agents: { agent1: { failureTimes: [recentTime], disabledTo: futureTime } } }),
      "utf8",
    );
    const result = await isHealthy(stateFile, "agent1");
    expect(result).toBe(false);
  });

  it("returns true when disabledTo is in the past", async () => {
    const pastTime = new Date(Date.now() - 60000).toISOString();
    fs.writeFileSync(
      stateFile,
      JSON.stringify({ agents: { agent1: { failureTimes: ["2020-01-01T00:00:00Z"], disabledTo: pastTime } } }),
      "utf8",
    );
    const result = await isHealthy(stateFile, "agent1");
    expect(result).toBe(true);
  });
});

describe("filterHealthy", () => {
  let stateDir: string;
  let stateFile: string;
  const agents = [makeAgent("a"), makeAgent("b"), makeAgent("c")];

  beforeEach(() => {
    stateDir = path.join(os.tmpdir(), `at-health-test-${Date.now()}`);
    stateFile = path.join(stateDir, "state.json");
    fs.mkdirSync(stateDir, { recursive: true });
  });

  afterEach(() => {
    if (fs.existsSync(stateFile)) fs.unlinkSync(stateFile);
    try {
      fs.rmdirSync(stateDir);
    } catch {
      /* not empty */
    }
  });

  it("returns all agents when all are healthy", async () => {
    const result = await filterHealthy(stateFile, agents);
    expect(result.map((a) => a.name)).toEqual(["a", "b", "c"]);
  });

  it("returns only healthy agents", async () => {
    // Make agent 'b' unhealthy by setting disabledTo in the future
    const futureTime = new Date(Date.now() + 60000).toISOString();
    const recentTime = new Date(Date.now() - 1000).toISOString();
    fs.writeFileSync(
      stateFile,
      JSON.stringify({
        agents: { b: { failureTimes: [recentTime], disabledTo: futureTime } },
      }),
      "utf8",
    );

    const result = await filterHealthy(stateFile, agents);
    expect(result.map((a) => a.name)).toEqual(["a", "c"]);
  });
});

describe("isDeactivated", () => {
  let stateDir: string;
  let stateFile: string;

  beforeEach(() => {
    stateDir = path.join(os.tmpdir(), `at-health-test-${Date.now()}`);
    stateFile = path.join(stateDir, "state.json");
    fs.mkdirSync(stateDir, { recursive: true });
  });

  afterEach(() => {
    if (fs.existsSync(stateFile)) fs.unlinkSync(stateFile);
    try {
      fs.rmdirSync(stateDir);
    } catch {
      /* not empty */
    }
  });

  it("returns false for unknown agent", () => {
    const result = isDeactivated(stateFile, "unknown");
    expect(result).toBe(false);
  });

  it("returns true when deactivated flag is set", () => {
    fs.writeFileSync(
      stateFile,
      JSON.stringify({ agents: { agent1: { failureTimes: [], disabledTo: null, deactivated: true } } }),
      "utf8",
    );
    const result = isDeactivated(stateFile, "agent1");
    expect(result).toBe(true);
  });

  it("returns false when deactivated flag is not set", () => {
    fs.writeFileSync(stateFile, JSON.stringify({ agents: { agent1: { failureTimes: [], disabledTo: null } } }), "utf8");
    const result = isDeactivated(stateFile, "agent1");
    expect(result).toBe(false);
  });
});

describe("setDeactivated", () => {
  let stateDir: string;
  let stateFile: string;

  beforeEach(() => {
    stateDir = path.join(os.tmpdir(), `at-health-test-${Date.now()}`);
    stateFile = path.join(stateDir, "state.json");
    fs.mkdirSync(stateDir, { recursive: true });
  });

  afterEach(() => {
    if (fs.existsSync(stateFile)) fs.unlinkSync(stateFile);
    try {
      fs.rmdirSync(stateDir);
    } catch {
      /* not empty */
    }
  });

  it("sets deactivated flag to true", async () => {
    await setDeactivated(stateFile, "agent1", true);
    const state = loadHealth(stateFile);
    expect(state.agents.agent1.deactivated).toBe(true);
  });

  it("sets deactivated flag to false", async () => {
    // First set to true
    await setDeactivated(stateFile, "agent1", true);
    // Then set to false
    await setDeactivated(stateFile, "agent1", false);
    const state = loadHealth(stateFile);
    expect(state.agents.agent1.deactivated).toBeUndefined();
  });
});

describe("quota auto-deactivation", () => {
  let stateDir: string;
  let stateFile: string;

  beforeEach(() => {
    stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "at-health-quota-"));
    stateFile = path.join(stateDir, "state.json");
  });

  afterEach(() => {
    delete process.env.AT_DEACTIVATE_TTL_MS;
    fs.rmSync(stateDir, { recursive: true, force: true });
  });

  it("a quota-triggered deactivation keeps the agent deactivated", async () => {
    // Exactly what the quota failure paths in runner.ts / run-watch.ts do.
    await setDeactivated(stateFile, "mm-code", true);
    expect(isDeactivated(stateFile, "mm-code")).toBe(true);
    const state = loadHealth(stateFile);
    expect(state.agents["mm-code"].deactivated).toBe(true);
    expect(new Date(state.agents["mm-code"].deactivatedAt as string).getTime()).toBeLessThanOrEqual(Date.now());
  });

  it("auto-reactivates after AT_DEACTIVATE_TTL_MS elapses and persists it", async () => {
    process.env.AT_DEACTIVATE_TTL_MS = "1000";
    const expired = new Date(Date.now() - 5000).toISOString();
    fs.writeFileSync(
      stateFile,
      JSON.stringify({
        agents: { "mm-code": { failureTimes: [], disabledTo: null, deactivated: true, deactivatedAt: expired } },
      }),
      "utf8",
    );

    expect(isDeactivated(stateFile, "mm-code")).toBe(false);
    // TTL reactivation is fire-and-forget — let the write settle before asserting on disk.
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(loadHealth(stateFile).agents["mm-code"].deactivated).toBeUndefined();
  });

  it("is cleared again by the `at enable` path", async () => {
    await setDeactivated(stateFile, "mm-code", true);
    await setDeactivated(stateFile, "mm-code", false);
    expect(isDeactivated(stateFile, "mm-code")).toBe(false);
  });

  it("stays deactivated while inside a shortened AT_DEACTIVATE_TTL_MS", () => {
    process.env.AT_DEACTIVATE_TTL_MS = "60000";
    const recent = new Date(Date.now() - 1000).toISOString();
    fs.writeFileSync(
      stateFile,
      JSON.stringify({
        agents: { "mm-code": { failureTimes: [], disabledTo: null, deactivated: true, deactivatedAt: recent } },
      }),
      "utf8",
    );

    expect(isDeactivated(stateFile, "mm-code")).toBe(true);
  });
});

describe("resetAgent", () => {
  let stateDir: string;
  let stateFile: string;

  beforeEach(() => {
    stateDir = path.join(os.tmpdir(), `at-health-test-${Date.now()}`);
    stateFile = path.join(stateDir, "state.json");
    fs.mkdirSync(stateDir, { recursive: true });
  });

  afterEach(() => {
    if (fs.existsSync(stateFile)) fs.unlinkSync(stateFile);
    try {
      fs.rmdirSync(stateDir);
    } catch {
      /* not empty */
    }
  });

  it("clears failureTimes and disabledTo for agent", async () => {
    // Pre-populate with failures
    const futureTime = new Date(Date.now() + 60000).toISOString();
    fs.writeFileSync(
      stateFile,
      JSON.stringify({
        agents: { agent1: { failureTimes: [new Date().toISOString()], disabledTo: futureTime } },
      }),
      "utf8",
    );

    await resetAgent(stateFile, "agent1");
    const state = loadHealth(stateFile);
    expect(state.agents.agent1.failureTimes).toEqual([]);
    expect(state.agents.agent1.disabledTo).toBeNull();
  });

  it("creates agent entry if it does not exist", async () => {
    await resetAgent(stateFile, "newAgent");
    const state = loadHealth(stateFile);
    expect(state.agents.newAgent).toEqual({ failureTimes: [], disabledTo: null });
  });
});
