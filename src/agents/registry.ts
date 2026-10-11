const NODE_BIN = process.env.NODE_BIN ?? require("path").dirname(process.execPath);
const LOCAL_BIN = process.env.LOCAL_BIN ?? `${process.env.HOME}/.local/bin`;
const DEVIN_DESKTOP_BIN = "/usr/share/devin-desktop/resources/app/extensions/windsurf/devin/bin/devin";

function findBin(name: string): string {
  const fs = require("fs");
  for (const dir of [NODE_BIN, LOCAL_BIN]) {
    const p = `${dir}/${name}`;
    if (fs.existsSync(p)) return p;
  }
  return `${NODE_BIN}/${name}`;
}

// Token for the z.ai (Zhipu) OpenAI/Anthropic-compatible coding endpoint.
// Same value as the user's ANTHROPIC_AUTH_TOKEN / cline `openAiApiKey`; used
// to authenticate the `openai-compatible` cline provider.
const ZAI_BASE_URL = "https://api.z.ai/api/coding/paas/v4";

function resolveZaiApiKey(): string | undefined {
  // Ignore placeholder values (e.g. `test`) that would shadow a real token.
  const plausible = (k: string | undefined): k is string => !!k && k.trim().length >= 20;
  if (plausible(process.env.ZAI_API_KEY)) return process.env.ZAI_API_KEY;
  if (plausible(process.env.ANTHROPIC_AUTH_TOKEN)) return process.env.ANTHROPIC_AUTH_TOKEN;
  try {
    const fs = require("fs");
    const p = `${process.env.HOME}/.cline/data/secrets.json`;
    const key = JSON.parse(fs.readFileSync(p, "utf8"))?.openAiApiKey;
    if (typeof key === "string" && key) return key;
  } catch {
    /* fall through */
  }
  return undefined;
}

// Seed a per-run cline data dir with an `openai-compatible` provider config.
// cline stores provider auth in `<data-dir>/settings/providers.json`; without
// it, runs against a fresh data dir would need interactive `cline auth`.
function seedClineProviderConfig(dataDir: string, apiKey: string, model: string): void {
  const fs = require("fs");
  const path = require("path");
  const settingsDir = path.join(dataDir, "settings");
  fs.mkdirSync(settingsDir, { recursive: true });
  fs.writeFileSync(
    path.join(settingsDir, "providers.json"),
    JSON.stringify({
      version: 1,
      lastUsedProvider: "openai-compatible",
      modes: {},
      providers: {
        "openai-compatible": {
          settings: {
            provider: "openai-compatible",
            apiKey,
            model,
            baseUrl: ZAI_BASE_URL,
          },
          updatedAt: new Date().toISOString(),
          tokenSource: "manual",
        },
      },
    }),
  );
}

export interface AgentDef {
  name: string;
  tier: 1 | 2 | 3 | 4;
  bin: () => string;
  buildArgs: (prompt: string, model?: string, cwd?: string) => string[];
  buildEnv?: (model?: string) => Record<string, string>;
  promptMode?: "arg" | "stdin";
}

// pi (@earendil-works/pi-coding-agent) authenticates via its own
// `~/.pi/agent/auth.json` (set with `/login openrouter`); an ambient
// OPENROUTER_API_KEY env var is only a fallback and never overrides it. Its
// settings default (`defaultModel: openrouter/free`) is not a stable model
// reference, so pin the OpenRouter free model explicitly for at runs.
const PI_OPENROUTER_MODEL = "openrouter/free";

export const AGENTS: AgentDef[] = [
  // Tier 1: architect / review
  {
    name: "glm-code",
    tier: 1,
    bin: () => process.env.GLM_CODE_BIN ?? `${LOCAL_BIN}/glm-code`,
    buildArgs: (prompt) => ["-p", prompt, "--dangerously-skip-permissions"],
  },
  {
    name: "codex",
    tier: 1,
    bin: () => process.env.CODEX_BIN ?? `${NODE_BIN}/codex`,
    buildArgs: (prompt) => ["exec", "--yolo", "--skip-git-repo-check", prompt],
  },
  {
    name: "kimi",
    tier: 1,
    bin: () => process.env.KIMI_BIN ?? `${LOCAL_BIN}/kimi`,
    buildArgs: (prompt) => ["-y", "-p", prompt],
  },

  // Tier 2: dev / QA (default)
  {
    name: "mm-code",
    tier: 2,
    bin: () => process.env.MM_CODE_BIN ?? `${LOCAL_BIN}/mm-code`,
    buildArgs: (prompt) => ["-p", prompt, "--dangerously-skip-permissions"],
  },
  {
    name: "opencode",
    tier: 2,
    bin: () => process.env.OPENCODE_BIN ?? `${NODE_BIN}/opencode`,
    buildArgs: (prompt, model) =>
      model
        ? ["run", "--dangerously-skip-permissions", "-m", model, prompt]
        : ["run", "--dangerously-skip-permissions", prompt],
    buildEnv: (model) => (model ? { OPENCODE_MODEL: model } : ({} as Record<string, string>)),
  },
  {
    name: "qwen",
    tier: 2,
    bin: () => process.env.QWEN_BIN ?? `${NODE_BIN}/qwen`,
    buildArgs: (prompt) => ["-y", prompt],
  },
  {
    name: "pi",
    tier: 2,
    bin: () => process.env.PI_BIN ?? `${NODE_BIN}/pi`,
    buildArgs: (prompt, model) => ["-p", "--model", model ?? process.env.PI_MODEL ?? PI_OPENROUTER_MODEL, prompt],
  },

  // Tier 3: boilerplate / gen
  {
    name: "kilo",
    tier: 3,
    bin: () => process.env.KILO_BIN ?? `${NODE_BIN}/kilo`,
    buildArgs: (prompt) => ["run", "--auto", prompt],
  },
  {
    name: "agy",
    tier: 3,
    bin: () => process.env.AGY_BIN ?? findBin("agy"),
    buildArgs: (prompt) => ["--dangerously-skip-permissions", "-p", prompt],
  },
  {
    name: "kiro",
    tier: 3,
    bin: () => process.env.KIRO_BIN ?? findBin("kiro-cli"),
    buildArgs: (prompt) => ["chat", "--no-interactive", "--trust-all-tools", prompt],
  },
  {
    name: "devin",
    tier: 3,
    bin: () => {
      if (process.env.DEVIN_BIN) return process.env.DEVIN_BIN;
      const local = `${LOCAL_BIN}/devin`;
      if (require("fs").existsSync(local)) return local;
      return DEVIN_DESKTOP_BIN;
    },
    buildArgs: (prompt) => ["--permission-mode", "bypass", "--respect-workspace-trust", "false", "-p", prompt],
  },

  {
    name: "cline",
    tier: 2,
    bin: () => process.env.CLINE_BIN ?? `${NODE_BIN}/cline`,
    buildArgs: (prompt, model, cwd) => {
      // Per-run isolated cline data dir: the cline v3 hub daemon
      // (`--cline-hub-daemon`) keeps long-lived state in `~/.cline/data` by
      // default, so back-to-back runs share a hub and the LLM keeps
      // exploring leftover context instead of following the prompt suffix.
      // A fresh, run-scoped data dir forces cline to spin up a clean
      // hub (or skip the persistent one) and behave as if first-time.
      const dataDir = process.env.CLINE_DATA_DIR ?? `/tmp/cline-data-${process.pid}-${Date.now()}`;
      const args: string[] = [
        "-y", // yolo: auto-approve + exit when task is done (unsupervised)
        "--json", // structured output for the SSE adapter
        "--cwd",
        cwd ?? process.cwd(),
        "--data-dir",
        dataDir,
        // Hard cap under the 150s sandbox timeout: leaves 30s headroom for
        // runner cleanup before run-watch marks the run failed.
        "--timeout",
        "120",
        // Clamp consecutive tool-error retries so a single stuck command does
        // not eat the whole timeout budget.
        "--retries",
        "2",
        // Keep the model on a short reasoning leash — sandbox E2E was
        // failing because cline spent its budget reading the runner's source
        // and polling the discuss thread instead of just running the one
        // command the suffix specifies.
        "--thinking",
        "none",
      ];
      // The `cline` free-tier provider 401s: it needs an interactive
      // `cline auth cline` OAuth sign-in, which cannot be done
      // non-interactively. Re-point to the z.ai OpenAI-compatible coding
      // endpoint (`openai-compatible` provider), which is authenticated on
      // this host via the same token the anthropic-compatible tools use
      // (mm-code/glm-code). `openai-native` is NOT usable here: it calls
      // the Responses API, which z.ai does not implement; the `anthropic`
      // provider rejects non-`sk-ant-` keys client-side.
      const modelId = model ?? process.env.CLINE_MODEL ?? "glm-5.3-flash";
      const apiKey = resolveZaiApiKey();
      if (apiKey) {
        seedClineProviderConfig(dataDir, apiKey, modelId);
        args.push("-P", "openai-compatible");
      } else {
        // No z.ai token available — fall back to the previous behavior
        // (free-tier provider; will 401 until `cline auth cline` is done).
        args.push("-P", "cline");
      }
      args.push("-m", modelId);
      args.push(prompt);
      return args;
    },
  },

  // Mock: dry-run / test agent
  {
    name: "mock",
    tier: 4,
    bin: () => process.env.MOCK_BIN ?? `${LOCAL_BIN}/mock-agent`,
    buildArgs: (prompt) => [prompt],
  },

  // MockLong: simulates long-running agent with streaming output, controlled by --duration flag
  {
    name: "mock-long",
    tier: 4,
    bin: () => process.env.MOCK_LONG_BIN ?? `${LOCAL_BIN}/mock-long-agent`,
    buildArgs: (prompt, _model?: string) => [prompt],
    buildEnv: () => ({ MOCK_LONG_DURATION: process.env.MOCK_LONG_DURATION ?? "30000" }),
  },
];

export function getAgentsByTier(tier: 1 | 2 | 3 | 4): AgentDef[] {
  return AGENTS.filter((a) => a.tier === tier);
}

export function getAgentByName(name: string): AgentDef | undefined {
  return AGENTS.find((a) => a.name === name);
}
