import { existsSync, writeFileSync, mkdirSync } from 'fs';
import { dirname } from 'path';
import { AGENTS, AgentDef } from '../agents/registry';

// ── Template system ──

export interface WrapperTemplate {
  agentName: string;
  description: string;
  content: string;
}

const BUILTIN_TEMPLATES: Record<string, WrapperTemplate> = {
  'glm-code': {
    agentName: 'glm-code',
    description: 'Claude Code wrapper pointed at GLM (Z.AI) with isolated config',
    content: `#!/bin/bash
# glm-code — Claude Code pointed at GLM (Z.AI) with fully isolated config
#
# Secrets stored in system keyring (file-based, GPG-encrypted).
# Token is never written to disk in plaintext, never in shell history.
#
# Setup (run once):
#   /usr/bin/keyring set glm-code zai-api-key
#   (paste your Z.AI API key, press Enter)
#
# Verify it was stored:
#   /usr/bin/keyring get glm-code zai-api-key
#
# This keeps your normal Claude Code subscription completely separate.

set -euo pipefail

# ── Isolated config directory ──
CLAUDE_CONFIG_DIR="$HOME/.config/glm-code"
export CLAUDE_CONFIG_DIR

# ── Z.AI Anthropic-compatible endpoint ──
export ANTHROPIC_BASE_URL="https://api.z.ai/api/anthropic"

# ── Retrieve API key from system keyring ──
ZAI_KEY="$(/usr/bin/keyring get glm-code zai-api-key 2>/dev/null)" || true

if [ -z "$ZAI_KEY" ]; then
    echo "ERROR: Z.AI API key not found in system keyring." >&2
    echo "" >&2
    echo "  Store it once with:" >&2
    echo "    /usr/bin/keyring set glm-code zai-api-key" >&2
    echo "  (paste the key, then press Enter)" >&2
    exit 1
fi
export ANTHROPIC_AUTH_TOKEN="$ZAI_KEY"

# ── Confirm config directory exists ──
mkdir -p "$CLAUDE_CONFIG_DIR"

# ── Launch Claude Code with all args passed through ──
exec claude "$@"
`,
  },

  'mm-code': {
    agentName: 'mm-code',
    description: 'Claude Code wrapper pointed at MiniMax M2.7 with isolated config',
    content: `#!/bin/bash
# mm-code — Claude Code pointed at MiniMax (M2.7) with fully isolated config
#
# Secrets stored in system keyring (file-based, GPG-encrypted).
# Token is never written to disk in plaintext, never in shell history.
#
# Setup (run once):
#   /usr/bin/keyring set mm-code mm-api-key
#   (paste your MiniMax API key, press Enter)
#
# Verify it was stored:
#   /usr/bin/keyring get mm-code mm-api-key
#
# This keeps your normal Claude Code subscription completely separate.

set -euo pipefail

# ── Isolated config directory ──
CLAUDE_CONFIG_DIR="$HOME/.config/mm-code"
export CLAUDE_CONFIG_DIR

# ── MiniMax Anthropic-compatible endpoint ──
export ANTHROPIC_BASE_URL="https://api.minimax.io/anthropic"

# ── Model selection ──
export ANTHROPIC_MODEL="MiniMax-M2.7"
export ANTHROPIC_DEFAULT_SONNET_MODEL="MiniMax-M2.7"
export ANTHROPIC_DEFAULT_OPUS_MODEL="MiniMax-M2.7"
export ANTHROPIC_DEFAULT_HAIKU_MODEL="MiniMax-M2.7"

# ── Retrieve API key from system keyring ──
MM_KEY="$(/usr/bin/keyring get mm-code mm-api-key 2>/dev/null)" || true

if [ -z "$MM_KEY" ]; then
    echo "ERROR: MiniMax API key not found in system keyring." >&2
    echo "" >&2
    echo "  Store it once with:" >&2
    echo "    /usr/bin/keyring set mm-code mm-api-key" >&2
    echo "  (paste the key, then press Enter)" >&2
    exit 1
fi
export ANTHROPIC_AUTH_TOKEN="$MM_KEY"

# ── Confirm config directory exists ──
mkdir -p "$CLAUDE_CONFIG_DIR"

# ── Launch Claude Code with all args passed through ──
exec claude "$@"
`,
  },

  'mock': {
    agentName: 'mock',
    description: 'Dry-run / test agent — prints prompt and exits successfully',
    content: `#!/bin/bash
# mock — dry-run / test agent for \`at\`
# Prints the prompt and environment info, then exits successfully.

set -e

PROMPT="$1"

if [ -z "$PROMPT" ]; then
    echo "[mock] ERROR: no prompt provided" >&2
    exit 1
fi

echo "[mock] received prompt: \${PROMPT}"
echo "[mock] working directory: \$(pwd)"
echo "[mock] timestamp: \$(date -Iseconds)"
echo "[mock] done" >&2
exit 0
`,
  },

  'mock-long': {
    agentName: 'mock-long',
    description: 'Simulates long-running agent with streaming output — controlled by MOCK_LONG_DURATION env var (default 30000ms)',
    content: `#!/bin/bash
# mock-long — simulates long-running agent with streaming output
# Controlled by MOCK_LONG_DURATION env var (default: 30000ms = 30 seconds)
# Useful for testing log streaming behavior.

set -e

PROMPT="$1"
DURATION="\${MOCK_LONG_DURATION:-30000}"
ITERATION_MS=2000

if [ -z "$PROMPT" ]; then
    echo "[mock-long] ERROR: no prompt provided" >&2
    exit 1
fi

echo "[mock-long] started — duration: \${DURATION}ms"
echo "[mock-long] received prompt: \${PROMPT}"
echo "[mock-long] working directory: $(pwd)"

START_TIME=$(date +%s%3N)
ITER=0

while true; do
    CURRENT_TIME=$(date +%s%3N)
    ELAPSED=$((CURRENT_TIME - START_TIME))

    if [ $ELAPSED -ge $DURATION ]; then
        echo "[mock-long] iteration $ITER: done (elapsed: \${ELAPSED}ms)"
        echo "[mock-long] completed successfully after \${ELAPSED}ms" >&2
        exit 0
    fi

    echo "[mock-long] iteration $ITER: working... (elapsed: \${ELAPSED}ms/\${DURATION}ms)"
    sleep 0.1
    echo "[mock-long] iteration $ITER: wrote file step-$(printf '%03d' $ITER).txt with content"
    echo "content for step $ITER" > "step-$(printf '%03d' $ITER).txt"
    sleep 0.1
    echo "[mock-long] iteration $ITER: analyzing structure"
    sleep 0.1
    echo "[mock-long] iteration $ITER: thinking..."

    ITER=$((ITER + 1))
    sleep $((ITERATION_MS / 1000))
done
`,
  },
};

// ── Public API ──

export interface InitOptions {
  agent?: string;
  all?: boolean;
  list?: boolean;
  force?: boolean;
  dryRun?: boolean;
}

export interface InitResult {
  agent: string;
  targetPath: string;
  action: 'created' | 'skipped' | 'would_create';
  reason?: string;
}

function resolveTargets(
  options: InitOptions,
): Array<{ agent: AgentDef; template: WrapperTemplate }> {
  const agentNames = getTemplateAgentNames();

  if (options.list) {
    return agentNames
      .map((name) => AGENTS.find((a) => a.name === name)!)
      .filter(Boolean)
      .map((agent) => ({
        agent,
        template: BUILTIN_TEMPLATES[agent.name],
      }));
  }

  if (options.all) {
    return agentNames
      .map((name) => AGENTS.find((a) => a.name === name)!)
      .filter(Boolean)
      .map((agent) => ({
        agent,
        template: BUILTIN_TEMPLATES[agent.name],
      }));
  }

  if (options.agent) {
    const template = BUILTIN_TEMPLATES[options.agent];
    if (!template) {
      const available = getTemplateAgentNames().join(', ');
      throw new Error(
        `No template defined for agent: ${options.agent}. Available: ${available}`,
      );
    }
    const agent = AGENTS.find((a) => a.name === options.agent);
    if (!agent) {
      throw new Error(`Agent '${options.agent}' not found in registry`);
    }
    return [{ agent, template }];
  }

  throw new Error('Specify an agent name, --all, or --list');
}

export function getTemplateAgentNames(): string[] {
  return Object.keys(BUILTIN_TEMPLATES);
}

export function getTemplate(agentName: string): WrapperTemplate | undefined {
  return BUILTIN_TEMPLATES[agentName];
}

export function runInit(options: InitOptions): InitResult[] {
  if (options.list) {
    const targets = resolveTargets(options);
    return targets.map(({ agent, template }) => {
      const targetPath = agent.bin();
      const exists = existsSync(targetPath);
      return {
        agent: agent.name,
        targetPath,
        action: exists ? 'skipped' : 'would_create',
        reason: exists ? 'already exists' : 'missing (would be created by init)',
      };
    });
  }

  const targets = resolveTargets(options);
  const results: InitResult[] = [];

  for (const { agent, template } of targets) {
    const targetPath = agent.bin();

    if (existsSync(targetPath) && !options.force) {
      results.push({
        agent: agent.name,
        targetPath,
        action: 'skipped',
        reason: `already exists (use --force to overwrite)`,
      });
      continue;
    }

    if (options.dryRun) {
      results.push({
        agent: agent.name,
        targetPath,
        action: 'would_create',
      });
      continue;
    }

    mkdirSync(dirname(targetPath), { recursive: true });
    writeFileSync(targetPath, template.content, { mode: 0o755 });

    results.push({
      agent: agent.name,
      targetPath,
      action: 'created',
    });
  }

  return results;
}

export function formatInitResults(results: InitResult[]): string {
  return results
    .map((r) => {
      const prefix =
        r.action === 'created'
          ? 'CREATED'
          : r.action === 'would_create'
            ? 'WOULD CREATE'
            : 'SKIP';
      const reason = r.reason ? ` (${r.reason})` : '';
      return `${prefix} ${r.agent} → ${r.targetPath}${reason}`;
    })
    .join('\n');
}
