import { describe, expect, it } from "vitest";
import {
  type AgentHealthInput,
  type AgentRunStatsInput,
  agentHealthState,
  buildAgentGroups,
  filterAgentGroupsByQuery,
  isAgentRowEnabled,
  toggleIntent,
} from "../../../src/tui/components/agents-model";
import { AGENT_HEALTH_CONFIG, TIER_CONFIG } from "../../../src/ui-spec";

interface AgentFixture {
  name: string;
  tier: 1 | 2 | 3 | 4;
}

const agents: AgentFixture[] = [
  { name: "glm-code", tier: 1 },
  { name: "codex", tier: 1 },
  { name: "mm-code", tier: 2 },
  { name: "opencode", tier: 2 },
  { name: "qwen", tier: 2 },
  { name: "cline", tier: 2 },
  { name: "kilo", tier: 3 },
  { name: "mock", tier: 4 },
];

function runsFor(...entries: Array<[string, "done" | "failed"]>): AgentRunStatsInput {
  const stats = new Map<string, { runs: number; done: number; failed: number }>();
  for (const [name, status] of entries) {
    const s = stats.get(name) ?? { runs: 0, done: 0, failed: 0 };
    s.runs += 1;
    if (status === "done") s.done += 1;
    else s.failed += 1;
    stats.set(name, s);
  }
  return stats;
}

function healthFor(...entries: Array<[string, Partial<AgentHealthInput>]>): Map<string, AgentHealthInput> {
  const map = new Map<string, AgentHealthInput>();
  for (const [name, h] of entries) {
    map.set(name, { deactivated: false, disabledTo: null, failures: 0, ...h });
  }
  return map;
}

describe("agents-model", () => {
  describe("agentHealthState", () => {
    it("returns 'ok' when no failures and the agent is enabled", () => {
      expect(agentHealthState({ deactivated: false, disabledTo: null, failures: 0 })).toBe("ok");
    });

    it("returns 'failing' when there are recorded failures, even if disabled", () => {
      // Consecutive failures win over the disabled flag (docs/layout.md §7).
      expect(agentHealthState({ deactivated: true, disabledTo: null, failures: 2 })).toBe("failing");
    });

    it("returns 'disabled' when deactivated and no failures", () => {
      expect(agentHealthState({ deactivated: true, disabledTo: null, failures: 0 })).toBe("disabled");
    });

    it("returns 'disabled' while a quota window is still active", () => {
      expect(agentHealthState({ deactivated: false, disabledTo: "2099-01-01T00:00:00Z", failures: 0 })).toBe(
        "disabled",
      );
    });

    it("returns the matching glyph for each state", () => {
      const ok = agentHealthState({ deactivated: false, disabledTo: null, failures: 0 });
      const dis = agentHealthState({ deactivated: true, disabledTo: null, failures: 0 });
      const fail = agentHealthState({ deactivated: false, disabledTo: null, failures: 1 });
      expect(AGENT_HEALTH_CONFIG[ok].glyph).toBe("●");
      expect(AGENT_HEALTH_CONFIG[dis].glyph).toBe("○");
      expect(AGENT_HEALTH_CONFIG[fail].glyph).toBe("✗");
    });
  });

  describe("isAgentRowEnabled", () => {
    it("is true for an agent with no health record", () => {
      expect(isAgentRowEnabled(undefined)).toBe(true);
    });

    it("is false when the user toggle (deactivated) is set", () => {
      expect(isAgentRowEnabled({ deactivated: true, disabledTo: null, failures: 0 })).toBe(false);
    });

    it("is unaffected by a quota window — only the user toggle matters", () => {
      expect(isAgentRowEnabled({ deactivated: false, disabledTo: "2099-01-01T00:00:00Z", failures: 0 })).toBe(true);
    });
  });

  describe("toggleIntent", () => {
    it("disables an enabled agent", () => {
      const intent = toggleIntent({ enabled: true });
      expect(intent).toEqual({ enabled: false, intent: "disable" });
    });
    it("enables a disabled agent", () => {
      const intent = toggleIntent({ enabled: false });
      expect(intent).toEqual({ enabled: true, intent: "enable" });
    });
  });

  describe("buildAgentGroups", () => {
    it("groups registry agents by tier in spec order (1..4)", () => {
      const groups = buildAgentGroups(agents, new Map(), new Map());
      expect(groups.map((g) => g.tier)).toEqual([1, 2, 3, 4]);
      // Tiers with zero agents must still appear — the heading drives layout.
      const tier3 = groups.find((g) => g.tier === 3);
      expect(tier3?.agents.map((a) => a.name)).toEqual(["kilo"]);
    });

    it("renders the heading from TIER_CONFIG (Tier N — role)", () => {
      const groups = buildAgentGroups(agents, new Map(), new Map());
      const tier1 = groups.find((g) => g.tier === 1);
      expect(tier1?.heading).toBe(`${TIER_CONFIG[1].label} — ${TIER_CONFIG[1].role}`);
    });

    it("uses the health glyph for the agent health state", () => {
      const groups = buildAgentGroups(agents, new Map(), healthFor(["mm-code", { deactivated: true, failures: 0 }]));
      const mm = groups.flatMap((g) => g.agents).find((a) => a.name === "mm-code");
      expect(mm?.glyph).toBe(AGENT_HEALTH_CONFIG.disabled.glyph);
    });

    it("derives runs count and success% per agent from the stats map", () => {
      const stats = runsFor(["mm-code", "done"], ["mm-code", "done"], ["mm-code", "failed"]);
      const groups = buildAgentGroups(agents, stats, new Map());
      const mm = groups.flatMap((g) => g.agents).find((a) => a.name === "mm-code");
      expect(mm?.runs).toBe(3);
      // 2 of 3 finished succeeded → 67% (rounded).
      expect(mm?.successRatePct).toBe(67);
    });

    it("reports null success when no finished runs exist for an agent", () => {
      const stats = new Map(); // no runs recorded
      const groups = buildAgentGroups(agents, stats, new Map());
      const mm = groups.flatMap((g) => g.agents).find((a) => a.name === "mm-code");
      expect(mm?.runs).toBe(0);
      expect(mm?.successRatePct).toBeNull();
    });
  });

  describe("filterAgentGroupsByQuery", () => {
    const groups = buildAgentGroups(agents, new Map(), new Map());

    it("returns all groups and rows when query is blank", () => {
      const out = filterAgentGroupsByQuery(groups, "");
      const total = out.flatMap((g) => g.agents).length;
      expect(total).toBe(groups.flatMap((g) => g.agents).length);
    });

    it("narrows groups by case-insensitive name substring", () => {
      const out = filterAgentGroupsByQuery(groups, "MM");
      expect(out.flatMap((g) => g.agents).map((a) => a.name)).toEqual(["mm-code"]);
    });

    it("supports multi-token AND match (every token must hit an agent name)", () => {
      const out = filterAgentGroupsByQuery(groups, "code");
      // "code" is a substring of mm-code, glm-code, codex, opencode, mock(?) — but
      // mock=false, so we expect mm-code, glm-code, codex, opencode.
      const names = out
        .flatMap((g) => g.agents)
        .map((a) => a.name)
        .sort();
      expect(names).toEqual(["codex", "glm-code", "mm-code", "opencode"]);
    });

    it("keeps the empty-state-friendly shape: empty array when nothing matches", () => {
      const out = filterAgentGroupsByQuery(groups, "zzz-no-match");
      expect(out).toEqual([]);
    });
  });
});
