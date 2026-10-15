import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createSignal } from "solid-js";
import { type AgentDef, getAgentsByTier } from "../../agents/registry";
import { getStateFilePath, resolveStateDir } from "../../state-dir";

const [tier, setTier] = createSignal<1 | 2 | 3 | 4>(2);
const [agent, setAgent] = createSignal<string>("auto");
const [mode, setMode] = createSignal<"stream" | "detached">("stream");
const [retries, setRetries] = createSignal<number>(0);

export { agent, mode, retries, tier };

const TIERS: readonly [1, 2, 3, 4] = [1, 2, 3, 4];

/** Cycle order: `auto` first, then the registry agents in registration order.
 *  `auto` is the implicit "scheduler picks" sentinel — every other entry is a
 *  real built-in from `src/agents/registry.ts`. The registry is the source of
 *  truth so this list re-shapes whenever a new agent lands (no more stale
 *  hardcoded list missing `devin` etc.). */
function buildAgentListForTier(t: 1 | 2 | 3 | 4): string[] {
  const names = getAgentsByTier(t).map((a: AgentDef) => a.name);
  return ["auto", ...names];
}

const AGENTS_BY_TIER: Record<1 | 2 | 3 | 4, string[]> = {
  1: buildAgentListForTier(1),
  2: buildAgentListForTier(2),
  3: buildAgentListForTier(3),
  4: buildAgentListForTier(4),
};

const RETRIES_CYCLE: readonly [0, 1, 2, 3, 4] = [0, 1, 2, 3, 4];

export function cycleTier(): void {
  const idx = TIERS.indexOf(tier());
  const next = TIERS[(idx + 1) % TIERS.length];
  setTier(next);
  setAgent("auto");
  saveSettings();
}

export function cycleAgent(): void {
  const agents = AGENTS_BY_TIER[tier()];
  const idx = agents.indexOf(agent());
  const next = agents[(idx + 1) % agents.length];
  setAgent(next);
  saveSettings();
}

export function cycleMode(): void {
  setMode((m) => (m === "stream" ? "detached" : "stream"));
  saveSettings();
}

export function cycleRetries(): void {
  const current = retries();
  const idx = RETRIES_CYCLE.indexOf(current as 0 | 1 | 2 | 3 | 4);
  const next = RETRIES_CYCLE[(idx + 1) % RETRIES_CYCLE.length];
  setRetries(next);
  saveSettings();
}

export function loadSettings(): void {
  try {
    const stateDir = resolveStateDir();
    const path = getStateFilePath(stateDir);
    const data = JSON.parse(readFileSync(path, "utf8")) as {
      tui?: { settings?: { tier?: number; agent?: string; mode?: string; retries?: number } };
    };
    const settings = data.tui?.settings;
    if (settings) {
      // Accept any in-range tier (1..4), not just 1..3 — the previous cast
      // dropped tier 4 silently when reading a saved state file.
      if (typeof settings.tier === "number") {
        const value = settings.tier as 1 | 2 | 3 | 4;
        if (TIERS.includes(value)) setTier(value);
      }
      if (typeof settings.agent === "string") {
        const agents = AGENTS_BY_TIER[tier()];
        if (agents.includes(settings.agent)) {
          setAgent(settings.agent);
        }
      }
      if (settings.mode === "stream" || settings.mode === "detached") {
        setMode(settings.mode);
      }
      if (typeof settings.retries === "number" && RETRIES_CYCLE.includes(settings.retries as 0 | 1 | 2 | 3 | 4)) {
        setRetries(settings.retries);
      }
    }
  } catch {
    // ignore missing or malformed state.json
  }
}

export function saveSettings(): void {
  try {
    const stateDir = resolveStateDir();
    const path = getStateFilePath(stateDir);
    let data: Record<string, unknown> = {};
    try {
      data = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
    } catch {
      // ignore missing or malformed state.json
    }
    const tui = (data.tui as Record<string, unknown> | undefined) ?? {};
    tui.settings = {
      tier: tier(),
      agent: agent(),
      mode: mode(),
      retries: retries(),
    };
    data.tui = tui;
    mkdirSync(stateDir, { recursive: true });
    writeFileSync(path, JSON.stringify(data, null, 2), "utf8");
  } catch {
    // ignore write errors
  }
}

/** Snapshot of the agents-to-cycle for a given tier — test escape hatch so
 *  the test file can assert the registry shape without re-deriving it. */
export function agentsByTier(t: 1 | 2 | 3 | 4): readonly string[] {
  return AGENTS_BY_TIER[t];
}
