import type { NotifyAdapter, NotifyAdapterContext } from './types';
import { logAdapter } from './adapters/log';
import { makeClaudeAdapter } from './adapters/claude';
import { makeCodexAdapter } from './adapters/codex';
import { makeKimiAdapter } from './adapters/kimi';
import { makeQwenAdapter } from './adapters/qwen';
import { makeOpenCodeAdapter } from './adapters/opencode';
import { makePiAdapter } from './adapters/pi';
import { makeKiloAdapter } from './adapters/kilo';
import { makeClineAdapter } from './adapters/cline';
import { makeKiroAdapter } from './adapters/kiro';

const registry: Map<string, NotifyAdapter> = new Map();

registerAdapter('mm-code', makeClaudeAdapter('mm-code'));
registerAdapter('glm-code', makeClaudeAdapter('glm-code'));
registerAdapter('codex', makeCodexAdapter());
registerAdapter('kimi', makeKimiAdapter());
registerAdapter('qwen', makeQwenAdapter());
registerAdapter('opencode', makeOpenCodeAdapter());
registerAdapter('pi', makePiAdapter());
registerAdapter('kilo', makeKiloAdapter());
registerAdapter('cline', makeClineAdapter());
registerAdapter('kiro', makeKiroAdapter());
// cursor + agy fall through to log adapter (no structured output mode in registry)

export function registerAdapter(name: string, adapter: NotifyAdapter): void {
  registry.set(name, adapter);
}

export function getAdapter(agentName: string): NotifyAdapter {
  return registry.get(agentName) ?? logAdapter;
}

export interface NotifySetup {
  args: string[];
  env: Record<string, string>;
  promptSuffix: string;
  adapter: NotifyAdapter;
}

export function setupNotify(
  agentName: string,
  ctx: NotifyAdapterContext,
): NotifySetup {
  const adapter = getAdapter(agentName);
  const args = adapter.args?.(ctx) ?? [];
  const env = adapter.env?.(ctx) ?? {};
  const promptSuffix = adapter.promptSuffix?.(ctx) ?? '';
  return { args, env, promptSuffix, adapter };
}

export * from './types';
export * from './store';
export { startHub, type Hub } from './hub';
export { tailLogFile, type Tailer } from './tailer';
export { logAdapter, makeLogAdapter } from './adapters/log';
