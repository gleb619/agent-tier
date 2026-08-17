import { createSignal, Accessor } from 'solid-js';
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { resolveStateDir, getStateFilePath } from '../../state-dir';

const [tier, setTier] = createSignal<1 | 2 | 3 | 4>(2);
const [agent, setAgent] = createSignal<string>('auto');
const [mode, setMode] = createSignal<'stream' | 'detached'>('stream');
const [retries, setRetries] = createSignal<number>(0);

export { tier, agent, mode, retries };

const TIERS: readonly [1, 2, 3, 4] = [1, 2, 3, 4];
const AGENTS_BY_TIER: Record<1 | 2 | 3 | 4, string[]> = {
  1: ['auto', 'glm-code', 'codex', 'kimi'],
  2: ['auto', 'blackbox', 'mm-code', 'opencode', 'qwen', 'pi', 'cline'],
  3: ['auto', 'kilo', 'agy', 'goose', 'aider'],
  4: ['auto', 'mock', 'mock-long'],
};
const RETRIES_CYCLE: readonly [0, 1, 2, 3, 4] = [0, 1, 2, 3, 4];

export function cycleTier(): void {
  const idx = TIERS.indexOf(tier());
  const next = TIERS[(idx + 1) % TIERS.length];
  setTier(next);
  setAgent('auto');
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
  setMode((m) => (m === 'stream' ? 'detached' : 'stream'));
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
    const data = JSON.parse(readFileSync(path, 'utf8')) as {
      tui?: { settings?: { tier?: number; agent?: string; mode?: string; retries?: number } };
    };
    const settings = data.tui?.settings;
    if (settings) {
      if (typeof settings.tier === 'number' && TIERS.includes(settings.tier as 1 | 2 | 3 | 4)) {
        setTier(settings.tier as 1 | 2 | 3);
      }
      if (typeof settings.agent === 'string') {
        const agents = AGENTS_BY_TIER[tier()];
        if (agents.includes(settings.agent)) {
          setAgent(settings.agent);
        }
      }
      if (settings.mode === 'stream' || settings.mode === 'detached') {
        setMode(settings.mode);
      }
      if (typeof settings.retries === 'number' && RETRIES_CYCLE.includes(settings.retries as 0 | 1 | 2 | 3 | 4)) {
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
      data = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
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
    writeFileSync(path, JSON.stringify(data, null, 2), 'utf8');
  } catch {
    // ignore write errors
  }
}
