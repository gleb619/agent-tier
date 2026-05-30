const NODE_BIN = process.env.NODE_BIN ?? require('path').dirname(process.execPath);
const LOCAL_BIN = process.env.LOCAL_BIN ?? `${process.env.HOME}/.local/bin`;
const OLLAMA_MODEL = process.env.OLLAMA_MODEL ?? 'minimax-m2.7:cloud';

export interface AgentDef {
  name: string;
  tier: 1 | 2 | 3 | 4;
  bin: () => string;
  buildArgs: (prompt: string, model?: string) => string[];
  buildEnv?: (model?: string) => Record<string, string>;
  promptMode?: 'arg' | 'stdin';
}

export const AGENTS: AgentDef[] = [
  // Tier 1: architect / review
  {
    name: 'glm-code',
    tier: 1,
    bin: () => process.env.GLM_CODE_BIN ?? `${LOCAL_BIN}/glm-code`,
    buildArgs: (prompt) => ['-p', prompt, '--dangerously-skip-permissions'],
  },
  {
    name: 'codex',
    tier: 1,
    bin: () => process.env.CODEX_BIN ?? `${NODE_BIN}/codex`,
    buildArgs: (prompt) => ['exec', '--yolo', '--skip-git-repo-check', prompt],
  },
  {
    name: 'kimi',
    tier: 1,
    bin: () => process.env.KIMI_BIN ?? `${NODE_BIN}/kimi`,
    buildArgs: (prompt) => ['-y', '-p', prompt],
  },

  // Tier 2: dev / QA (default)
  {
    name: 'blackbox',
    tier: 2,
    bin: () => process.env.BLACKBOX_BIN ?? `${LOCAL_BIN}/blackbox`,
    buildArgs: (prompt) => ['-p', prompt, '--yolo'],
  },
  {
    name: 'mm-code',
    tier: 2,
    bin: () => process.env.MM_CODE_BIN ?? `${LOCAL_BIN}/mm-code`,
    buildArgs: (prompt) => ['-p', prompt, '--dangerously-skip-permissions'],
  },
  {
    name: 'opencode',
    tier: 2,
    bin: () => process.env.OPENCODE_BIN ?? `${NODE_BIN}/opencode`,
    buildArgs: (prompt, model) =>
      model
        ? ['run', '--dangerously-skip-permissions', '-m', model, prompt]
        : ['run', '--dangerously-skip-permissions', prompt],
    buildEnv: (model) => model ? { OPENCODE_MODEL: model } : {} as Record<string, string>,
  },
  {
    name: 'qwen',
    tier: 2,
    bin: () => process.env.QWEN_BIN ?? `${NODE_BIN}/qwen`,
    buildArgs: (prompt) => ['-y', prompt],
  },
  {
    name: 'pi',
    tier: 2,
    bin: () => process.env.PI_BIN ?? `${NODE_BIN}/pi`,
    buildArgs: (prompt, model) => [
      '-p',
      '--provider', 'ollama',
      '--model', model ?? OLLAMA_MODEL,
      '--no-session',
      prompt,
    ],
  },

  // Tier 3: boilerplate / gen
  {
    name: 'kilo',
    tier: 3,
    bin: () => process.env.KILO_BIN ?? `${NODE_BIN}/kilo`,
    buildArgs: (prompt) => ['run', '--auto', prompt],
  },
  {
    name: 'gemini',
    tier: 3,
    bin: () => process.env.GEMINI_BIN ?? `${NODE_BIN}/gemini`,
    buildArgs: () => ['--yolo', '--skip-trust'],
    promptMode: 'stdin',
  },
  {
    name: 'goose',
    tier: 3,
    bin: () => process.env.GOOSE_BIN ?? `${LOCAL_BIN}/goose`,
    buildArgs: (prompt, model) => [
      'run',
      '--text', prompt,
      '--model', model ?? OLLAMA_MODEL,
      '--provider', 'ollama',
      '--no-session',
      '-q',
    ],
    buildEnv: () => ({
      GOOSE_PROVIDER: process.env.GOOSE_PROVIDER ?? 'ollama',
    }),
  },
  {
    name: 'aider',
    tier: 3,
    bin: () => process.env.AIDER_BIN ?? `${LOCAL_BIN}/aider`,
    buildArgs: (prompt, model) => [
      '--model', `ollama/${model ?? OLLAMA_MODEL}`,
      '--message', prompt,
      '--yes-always',
      '--no-git',
      '--no-show-model-warnings',
      '--exit',
    ],
    buildEnv: () => ({
      OLLAMA_API_BASE: process.env.OLLAMA_API_BASE ?? 'http://127.0.0.1:11434',
    }),
  },

  {
    name: 'cursor',
    tier: 3,
    bin: () => process.env.CURSOR_BIN ?? `${LOCAL_BIN}/cursor-agent`,
    buildArgs: (prompt, model) =>
      model
        ? ['-p', prompt, '--yolo', '--trust', '--model', model]
        : ['-p', prompt, '--yolo', '--trust'],
  },

  {
    name: 'cline',
    tier: 3,
    bin: () => process.env.CLINE_BIN ?? `${NODE_BIN}/cline`,
    buildArgs: (prompt) => [
      '--auto-approve', 'true',
      '--json',
      '--timeout', '600',
      prompt,
    ],
  },

  // Mock: dry-run / test agent
  {
    name: 'mock',
    tier: 4,
    bin: () => process.env.MOCK_BIN ?? `${LOCAL_BIN}/mock-agent`,
    buildArgs: (prompt) => [prompt],
  },

  // MockLong: simulates long-running agent with streaming output, controlled by --duration flag
  {
    name: 'mock-long',
    tier: 4,
    bin: () => process.env.MOCK_LONG_BIN ?? `${LOCAL_BIN}/mock-long-agent`,
    buildArgs: (prompt, _model?: string) => [prompt],
    buildEnv: () => ({ MOCK_LONG_DURATION: process.env.MOCK_LONG_DURATION ?? '30000' }),
  },
];

export function getAgentsByTier(tier: 1 | 2 | 3 | 4): AgentDef[] {
  return AGENTS.filter((a) => a.tier === tier);
}

export function getAgentByName(name: string): AgentDef | undefined {
  return AGENTS.find((a) => a.name === name);
}
