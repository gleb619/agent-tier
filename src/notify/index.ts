import { makeClaudeAdapter } from "./adapters/claude";
import { makeClineAdapter } from "./adapters/cline";
import { makeCodexAdapter } from "./adapters/codex";
import { makeKiloAdapter } from "./adapters/kilo";
import { makeKimiAdapter } from "./adapters/kimi";
import { makeKiroAdapter } from "./adapters/kiro";
import { logAdapter } from "./adapters/log";
import { makeOpenCodeAdapter } from "./adapters/opencode";
import { makePiAdapter } from "./adapters/pi";
import { makeQwenAdapter } from "./adapters/qwen";
import type { NotifyAdapter, NotifyAdapterContext } from "./types";

const registry: Map<string, NotifyAdapter> = new Map();

registerAdapter("mm-code", makeClaudeAdapter("mm-code"));
registerAdapter("glm-code", makeClaudeAdapter("glm-code"));
registerAdapter("codex", makeCodexAdapter());
registerAdapter("kimi", makeKimiAdapter());
registerAdapter("qwen", makeQwenAdapter());
registerAdapter("opencode", makeOpenCodeAdapter());
registerAdapter("pi", makePiAdapter());
registerAdapter("kilo", makeKiloAdapter());
registerAdapter("cline", makeClineAdapter());
registerAdapter("kiro", makeKiroAdapter());
// agy falls through to log adapter (no structured output mode in registry)

export function registerAdapter(name: string, adapter: NotifyAdapter): void {
  registry.set(name, adapter);
}

export function getAdapter(agentName: string): NotifyAdapter {
  return registry.get(agentName) ?? logAdapter;
}

export interface NotifySetup {
  args: string[];
  env: Record<string, string>;
  promptPrefix: string;
  promptSuffix: string;
  adapter: NotifyAdapter;
}

export function setupNotify(agentName: string, ctx: NotifyAdapterContext): NotifySetup {
  const adapter = getAdapter(agentName);
  const args = adapter.args?.(ctx) ?? [];
  const env = adapter.env?.(ctx) ?? {};
  const promptPrefix = adapter.promptPrefix?.(ctx) ?? "";
  const promptSuffix = adapter.promptSuffix?.(ctx) ?? "";
  return { args, env, promptPrefix, promptSuffix, adapter };
}

export { logAdapter, makeLogAdapter } from "./adapters/log";
export { type Hub, startHub } from "./hub";
export * from "./store";
export { type Tailer, tailLogFile } from "./tailer";
export * from "./types";
