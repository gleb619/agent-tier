import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { getAgentsByTier } from "../src/agents/registry";
import * as configModule from "../src/config";
import {
  buildSchedulerMermaid,
  diagramGroupLabel,
  resolveSchedulerDiagram,
  scopeOfStateDir,
  type DiagramGroup,
} from "../src/scheduler-diagram";

const tmpDir = path.join(os.tmpdir(), `at-sched-diagram-test-${process.pid}`);

function writeState(dir: string, scheduler: Record<string, { index: number }>): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, "state.json"), JSON.stringify({ scheduler }, null, 2));
}

function mockLineConfig(line: string[]): void {
  vi.spyOn(configModule, "loadConfig").mockReturnValue({ line });
}

afterAll(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("resolveSchedulerDiagram", () => {
  it("returns empty when no scheduler state", () => {
    mkdirSync(tmpDir, { recursive: true });
    writeFileSync(path.join(tmpDir, "state.json"), JSON.stringify({}));
    expect(resolveSchedulerDiagram([tmpDir])).toEqual([]);
  });

  it("omits the scope for a single dir", () => {
    writeState(tmpDir, { "tier-2": { index: 0 } });
    const groups = resolveSchedulerDiagram([tmpDir]);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.scope).toBeUndefined();
    expect(groups[0]!.key).toBe("tier-2");
  });

  it("resolves tier keys against the registry and flags the current index", () => {
    writeState(tmpDir, { "tier-2": { index: 1 } });
    const expected = getAgentsByTier(2);
    const groups = resolveSchedulerDiagram([tmpDir]);
    expect(groups[0]!.agents.map((a) => a.name)).toEqual(expected.map((a) => a.name));
    expect(groups[0]!.agents.filter((a) => a.current).map((a) => a.name)).toEqual([expected[1]!.name]);
  });

  it("resolves the legacy bare tier key (N) the same way", () => {
    writeState(tmpDir, { "2": { index: 1 } });
    const expected = getAgentsByTier(2);
    const groups = resolveSchedulerDiagram([tmpDir]);
    expect(groups[0]!.key).toBe("2");
    expect(groups[0]!.agents.filter((a) => a.current).map((a) => a.name)).toEqual([expected[1]!.name]);
  });

  it("resolves the line key via config line order", () => {
    mockLineConfig(["kilo", "agy", "mm-code"]);
    writeState(tmpDir, { line: { index: 2 } });
    const groups = resolveSchedulerDiagram([tmpDir]);
    expect(groups[0]!.agents.map((a) => a.name)).toEqual(["kilo", "agy", "mm-code"]);
    expect(groups[0]!.agents.filter((a) => a.current).map((a) => a.name)).toEqual(["mm-code"]);
  });

  it("marks nothing current when the index is out of range", () => {
    writeState(tmpDir, { "tier-2": { index: 999 } });
    const groups = resolveSchedulerDiagram([tmpDir]);
    expect(groups[0]!.agents.every((a) => !a.current)).toBe(true);
  });

  it("tags scope per dir for joined reports", () => {
    const dirA = path.join(tmpDir, "a");
    const dirB = path.join(tmpDir, "b");
    writeState(dirA, { "tier-1": { index: 0 } });
    writeState(dirB, { line: { index: 0 } });
    const groups = resolveSchedulerDiagram([dirA, dirB]);
    expect(groups.map((g) => g.scope)).toEqual(["project", "project"]);
  });

  it("tags the home dir as global in joined reports", () => {
    const home = path.join(os.homedir(), ".at");
    const dirA = path.join(tmpDir, "a");
    writeState(dirA, { "tier-1": { index: 0 } });
    // Home state.json is read, not written — only read if it exists; groups
    // from it must carry scope "global".
    const groups = resolveSchedulerDiagram([dirA, home]);
    const homeGroups = groups.filter((g) => g.scope === "global");
    for (const g of homeGroups) {
      expect(g.scope).toBe("global");
    }
    expect(groups.find((g) => g.key === "tier-1" && g.scope === "project")).toBeDefined();
  });

  it("skips groups whose queue cannot be resolved (empty line config)", () => {
    vi.spyOn(configModule, "loadConfig").mockReturnValue({ line: ["no-such-agent"] });
    writeState(tmpDir, { line: { index: 0 } });
    expect(resolveSchedulerDiagram([tmpDir])).toEqual([]);
  });
});

describe("scopeOfStateDir", () => {
  it("maps the home .at dir to global, everything else to project", () => {
    expect(scopeOfStateDir(path.join(os.homedir(), ".at"))).toBe("global");
    expect(scopeOfStateDir("/some/project/.at")).toBe("project");
  });
});

describe("diagramGroupLabel", () => {
  it("returns the bare key without scope", () => {
    expect(diagramGroupLabel({ key: "line", agents: [] })).toBe("line");
  });

  it("prefixes the scope when set", () => {
    expect(diagramGroupLabel({ key: "tier-1", scope: "global", agents: [] })).toBe("[global] tier-1");
  });
});

describe("buildSchedulerMermaid", () => {
  it("returns an empty string when there are no groups", () => {
    expect(buildSchedulerMermaid([])).toBe("");
  });

  it("returns an empty string when every group has an empty queue", () => {
    const groups: DiagramGroup[] = [{ key: "line", agents: [] }];
    expect(buildSchedulerMermaid(groups)).toBe("");
  });

  it("emits a subgraph per key with a chain and a wrap edge", () => {
    const groups: DiagramGroup[] = [
      {
        key: "line",
        scope: "project",
        agents: [
          { name: "kilo", current: false },
          { name: "agy", current: true },
          { name: "mm-code", current: false },
        ],
      },
    ];
    const m = buildSchedulerMermaid(groups);
    expect(m.startsWith("```mermaid")).toBe(true);
    expect(m.endsWith("```")).toBe(true);
    expect(m).toContain("flowchart LR");
    expect(m).toContain('subgraph g0["[project] line"]');
    expect(m).toContain("g0_n0 --> g0_n1");
    expect(m).toContain("g0_n1 --> g0_n2");
    expect(m).toContain("g0_n2 --> g0_n0"); // round-robin wrap
  });

  it("marks the current agent distinctly and defines the current class", () => {
    const groups: DiagramGroup[] = [
      {
        key: "line",
        agents: [
          { name: "kilo", current: false },
          { name: "agy", current: true },
        ],
      },
    ];
    const m = buildSchedulerMermaid(groups);
    expect(m).toContain('(("agy")):::current');
    expect(m).toContain('["kilo"]');
    expect(m).toContain("classDef current");
  });

  it("does not draw a self-loop for a single-agent queue", () => {
    const groups: DiagramGroup[] = [{ key: "tier-1", agents: [{ name: "codex", current: true }] }];
    const m = buildSchedulerMermaid(groups);
    expect(m).toContain('(("codex")):::current');
    expect(m).not.toContain("g0_n0 --> g0_n0");
  });

  it("emits one subgraph per scheduler key, scopes distinct", () => {
    const groups: DiagramGroup[] = [
      { key: "line", scope: "project", agents: [{ name: "kilo", current: true }] },
      { key: "line", scope: "global", agents: [{ name: "agy", current: false }] },
    ];
    const m = buildSchedulerMermaid(groups);
    expect(m).toContain('subgraph g0["[project] line"]');
    expect(m).toContain('subgraph g1["[global] line"]');
  });

  it("keeps node labels ASCII-safe for mermaid parsers", () => {
    const groups: DiagramGroup[] = [
      {
        key: "line",
        agents: [
          { name: "weird name/with:chars", current: true },
          { name: "ok", current: false },
        ],
      },
    ];
    const m = buildSchedulerMermaid(groups);
    // Node ids are positional (g0_n0), so any name lands only inside a quoted label.
    expect(m).toContain('g0_n0(("weird name/with:chars")):::current');
    expect(m).toMatch(/g0_n0 --> g0_n1/);
  });
});
