const NODE_BIN = process.env.NODE_BIN ?? require('path').dirname(process.execPath);
const LOCAL_BIN = process.env.LOCAL_BIN ?? `${process.env.HOME}/.local/bin`;
const DEVIN_DESKTOP_BIN = '/usr/share/devin-desktop/resources/app/extensions/windsurf/devin/bin/devin';

function findBin(name: string): string {
  const fs = require('fs');
  for (const dir of [NODE_BIN, LOCAL_BIN]) {
    const p = `${dir}/${name}`;
    if (fs.existsSync(p)) return p;
  }
  return `${NODE_BIN}/${name}`;
}

export interface AgentDef {
  name: string;
  tier: 1 | 2 | 3 | 4;
  bin: () => string;
  buildArgs: (prompt: string, model?: string, cwd?: string) => string[];
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
    bin: () => process.env.KIMI_BIN ?? `${LOCAL_BIN}/kimi`,
    buildArgs: (prompt) => ['-y', '-p', prompt],
  },

  // Tier 2: dev / QA (default)
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
    buildArgs: (prompt, model) =>
      model
        ? ['-p', '--model', model, prompt]
        : ['-p', prompt],
  },

  // Tier 3: boilerplate / gen
  {
    name: 'kilo',
    tier: 3,
    bin: () => process.env.KILO_BIN ?? `${NODE_BIN}/kilo`,
    buildArgs: (prompt) => ['run', '--auto', prompt],
  },
  {
    name: 'agy',
    tier: 3,
    bin: () => process.env.AGY_BIN ?? findBin('agy'),
    buildArgs: (prompt) => ['--dangerously-skip-permissions', '-p', prompt],
  },
  {
    name: 'kiro',
    tier: 3,
    bin: () => process.env.KIRO_BIN ?? findBin('kiro-cli'),
    buildArgs: (prompt) => ['chat', '--no-interactive', '--trust-all-tools', prompt],
  },
  {
    name: 'devin',
    tier: 3,
    bin: () => {
      if (process.env.DEVIN_BIN) return process.env.DEVIN_BIN;
      const local = `${LOCAL_BIN}/devin`;
      if (require('fs').existsSync(local)) return local;
      return DEVIN_DESKTOP_BIN;
    },
    buildArgs: (prompt) => [
      '--permission-mode', 'bypass',
      '--respect-workspace-trust', 'false',
      '-p', prompt,
    ],
  },

  {
    name: 'cline',
    tier: 2,
    bin: () => process.env.CLINE_BIN ?? `${NODE_BIN}/cline`,
    buildArgs: (prompt, _model, cwd) => {
      // Per-run isolated cline data dir: the cline v3 hub daemon
      // (`--cline-hub-daemon`) keeps long-lived state in `~/.cline/data` by
      // default, so back-to-back runs share a hub and the LLM keeps
      // exploring leftover context instead of following the prompt suffix.
      // A fresh, run-scoped data dir forces cline to spin up a clean
      // hub (or skip the persistent one) and behave as if first-time.
      const dataDir = process.env.CLINE_DATA_DIR ?? `/tmp/cline-data-${process.pid}-${Date.now()}`;
      const args: string[] = [
        '-y',                              // yolo: auto-approve + exit when task is done (unsupervised)
        '--json',                          // structured output for the SSE adapter
        '--cwd', cwd ?? process.cwd(),
        '--data-dir', dataDir,
        // Hard cap under the 150s sandbox timeout: leaves 30s headroom for
        // runner cleanup before run-watch marks the run failed.
        '--timeout', '120',
        // Clamp consecutive tool-error retries so a single stuck command does
        // not eat the whole timeout budget.
        '--retries', '2',
        // Keep the model on a short reasoning leash — sandbox E2E was
        // failing because cline spent its budget reading the runner's source
        // and polling the discuss thread instead of just running the one
        // command the suffix specifies.
        '--thinking', 'none',
      ];
      // Pin the model when CLINE_MODEL is set (or the default `cline-free`
      // free-tier model). Without this, cline v3 sometimes auto-selects a
      // non-free-tier model via the same provider, which then 401s on the
      // user's free-tier account and the run dies before doing anything.
      const model = process.env.CLINE_MODEL ?? 'cline-free/step-5-preview';
      args.push('-m', model);
      args.push(prompt);
      return args;
    },
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
