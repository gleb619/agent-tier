import { beforeEach, describe, expect, it, vi } from "vitest";
import { getAgentsByTier } from "../../../src/agents/registry";
import {
  agent,
  agentsByTier,
  cycleAgent,
  cycleMode,
  cycleRetries,
  cycleTier,
  mode,
  retries,
  tier,
} from "../../../src/tui/store/settings";

vi.mock("fs", () => ({
  readFileSync: vi.fn(() => {
    throw new Error("ENOENT");
  }),
  writeFileSync: vi.fn(),
  mkdirSync: vi.fn(),
}));

// Solid.js createSignal creates module-level singletons. Each test must reset
// to a known state: tier=2, agent='auto', mode='stream', retries=0
function resetToKnown() {
  // cycleTier resets agent to 'auto'. Keep cycling until we land on tier 2.
  do {
    cycleTier();
  } while (tier() !== 2);
  if (mode() !== "stream") cycleMode();
  while (retries() !== 0) cycleRetries();
}

describe("settings store", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("cycleTier", () => {
    it("cycles tier 2 → 3 and resets agent to auto", () => {
      resetToKnown();
      cycleTier();
      expect(tier()).toBe(3);
      expect(agent()).toBe("auto");
    });

    it("cycles tier 3 → 4 and resets agent to auto", () => {
      resetToKnown();
      cycleTier();
      cycleTier();
      expect(tier()).toBe(4);
      expect(agent()).toBe("auto");
    });

    it("cycles tier 4 → 1 and resets agent to auto", () => {
      resetToKnown();
      cycleTier();
      cycleTier();
      cycleTier();
      expect(tier()).toBe(1);
      expect(agent()).toBe("auto");
    });

    it("cycles tier 1 → 2 and resets agent to auto", () => {
      resetToKnown();
      cycleTier();
      cycleTier();
      cycleTier();
      cycleTier();
      expect(tier()).toBe(2);
      expect(agent()).toBe("auto");
    });
  });

  describe("cycleAgent (tier 2)", () => {
    // Tier-2 registry order (alphabetical): mm-code, opencode, qwen, cline.
    // Cycle list is `auto` first then those names (`store/settings.ts` derives
    // it from `getAgentsByTier` so a registry edit re-shapes this list).
    it("cycles auto → mm-code", () => {
      resetToKnown();
      cycleAgent();
      expect(agent()).toBe("mm-code");
    });

    it("cycles mm-code → opencode", () => {
      resetToKnown();
      cycleAgent();
      cycleAgent();
      expect(agent()).toBe("opencode");
    });

    it("cycles opencode → qwen", () => {
      resetToKnown();
      cycleAgent();
      cycleAgent();
      cycleAgent();
      expect(agent()).toBe("qwen");
    });

    it("cycles qwen → cline", () => {
      resetToKnown();
      cycleAgent();
      cycleAgent();
      cycleAgent();
      cycleAgent();
      expect(agent()).toBe("cline");
    });

    it("cycles cline → auto (wraps around)", () => {
      resetToKnown();
      cycleAgent();
      cycleAgent();
      cycleAgent();
      cycleAgent();
      cycleAgent();
      expect(agent()).toBe("auto");
    });
  });

  describe("cycleMode", () => {
    it("toggles stream → detached", () => {
      resetToKnown();
      cycleMode();
      expect(mode()).toBe("detached");
    });

    it("toggles detached → stream", () => {
      resetToKnown();
      cycleMode();
      cycleMode();
      expect(mode()).toBe("stream");
    });
  });

  describe("cycleRetries", () => {
    it("cycles 0 → 1", () => {
      resetToKnown();
      cycleRetries();
      expect(retries()).toBe(1);
    });

    it("cycles 1 → 2", () => {
      resetToKnown();
      cycleRetries();
      cycleRetries();
      expect(retries()).toBe(2);
    });

    it("cycles 2 → 3", () => {
      resetToKnown();
      cycleRetries();
      cycleRetries();
      cycleRetries();
      expect(retries()).toBe(3);
    });

    it("cycles 3 → 4", () => {
      resetToKnown();
      cycleRetries();
      cycleRetries();
      cycleRetries();
      cycleRetries();
      expect(retries()).toBe(4);
    });

    it("cycles 4 → 0 (wraps around)", () => {
      resetToKnown();
      cycleRetries();
      cycleRetries();
      cycleRetries();
      cycleRetries();
      cycleRetries();
      expect(retries()).toBe(0);
    });
  });
});

describe("agentsByTier", () => {
  // `agentsByTier` must stay in lockstep with the registry — if the cycle list
  // drifts from `src/agents/registry.ts`, a user-visible agent is invisible
  // to the settings cycle. These tests fail loudly when that happens.
  it("starts with 'auto' followed by every registry agent for tier 2 (default)", () => {
    const list = agentsByTier(2);
    expect(list[0]).toBe("auto");
    // Registry tier-2 names in registration order; remove the synthetic
    // 'auto' sentinel before comparing.
    const registry = getAgentsByTier(2).map((a) => a.name);
    expect(list.slice(1)).toEqual(registry);
  });

  it("covers every tier with at least the 'auto' sentinel", () => {
    for (const t of [1, 2, 3, 4] as const) {
      const list = agentsByTier(t);
      expect(list.length, `tier ${t}`).toBeGreaterThan(0);
      expect(list[0]).toBe("auto");
    }
  });
});
