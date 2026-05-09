import { existsSync, writeFileSync, chmodSync, mkdirSync } from 'fs';
import { dirname } from 'path';
import { AGENTS, AgentDef } from './agents/registry';

// ── Template system ──
// Each built-in agent that needs a wrapper script (not just an npm-installed
// binary) has a template here. The target path is resolved from the agent's
// bin() function at init time, so *_BIN env vars are honoured.

export interface WrapperTemplate {
  agentName: string;
  description: string;
  /** The shell script content to write */
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

/**
 * Resolve which agent entries should be processed for init.
 * Returns the agent def + template pairs.
 */
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

/** Return the list of agent names that have built-in wrapper templates. */
export function getTemplateAgentNames(): string[] {
  return Object.keys(BUILTIN_TEMPLATES);
}

/** Get a template for a built-in agent, or undefined if none. */
export function getTemplate(agentName: string): WrapperTemplate | undefined {
  return BUILTIN_TEMPLATES[agentName];
}

/**
 * Run the init command. Returns results for each target.
 * Writes wrapper scripts to disk unless dryRun is true.
 */
export function runInit(options: InitOptions): InitResult[] {
  // list mode: just report status, don't write
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

    // Write the wrapper script
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

/**
 * Format init results for CLI output.
 */
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
