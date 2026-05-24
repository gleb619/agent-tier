import { createSignal, Accessor } from 'solid-js';

const [tier, setTier] = createSignal<1 | 2 | 3>(2);
const [agent, setAgent] = createSignal<string>('auto');
const [mode, setMode] = createSignal<'stream' | 'detached'>('stream');
const [retries, setRetries] = createSignal<number>(0);

export { tier, agent, mode, retries };

const TIERS: readonly [1, 2, 3] = [1, 2, 3];
const AGENTS_BY_TIER: Record<1 | 2 | 3, string[]> = {
  1: ['auto', 'glm-code', 'codex', 'kimi'],
  2: ['auto', 'blackbox', 'mm-code', 'opencode', 'qwen', 'pi'],
  3: ['auto', 'kilo', 'gemini', 'goose', 'aider', 'cline'],
  4: ['auto', 'mock', 'mock-long'],
};
const RETRIES_CYCLE: readonly [0, 1, 2, 3] = [0, 1, 2, 3];

export function cycleTier(): void {
  const idx = TIERS.indexOf(tier());
  const next = TIERS[(idx + 1) % TIERS.length];
  setTier(next);
  setAgent('auto');
}

export function cycleAgent(): void {
  const agents = AGENTS_BY_TIER[tier()];
  const idx = agents.indexOf(agent());
  const next = agents[(idx + 1) % agents.length];
  setAgent(next);
}

export function cycleMode(): void {
  setMode((m) => (m === 'stream' ? 'detached' : 'stream'));
}

export function cycleRetries(): void {
  const current = retries();
  const idx = RETRIES_CYCLE.indexOf(current as 0 | 1 | 2 | 3);
  const next = RETRIES_CYCLE[(idx + 1) % RETRIES_CYCLE.length];
  setRetries(next);
}
