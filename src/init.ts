import { existsSync, writeFileSync, readFileSync, mkdirSync } from 'fs';
import { dirname, basename, resolve } from 'path';
import { execSync } from 'child_process';
import { homedir } from 'os';
import { AGENTS, AgentDef } from './agents/registry';

// ── Template system (existing built-in wrapper scripts) ──

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

// ── Wrapper init (existing public API) ──

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

// ── ORCH Project Init ──

/** Role configuration for an ORCH agent that delegates to `at`. */
export interface OrchRole {
  /** Display name shown in orch agent list */
  name: string;
  /** `at` tier: 1=architect, 2=dev, 3=experimental */
  tier: 1 | 2 | 3;
  /** Role description passed to `orch agent add --role` */
  description: string;
}

const ORCH_ROLES: OrchRole[] = [
  {
    name: 'Arch',
    tier: 1,
    description:
      'Architect — strategic design, task decomposition, system planning (at tier 1)',
  },
  {
    name: 'Dev',
    tier: 2,
    description:
      'Developer — feature implementation, bug fixes, code generation (at tier 2)',
  },
  {
    name: 'QA',
    tier: 2,
    description:
      'QA — testing, validation, linting, quality assurance (at tier 2)',
  },
  {
    name: 'Reviewer',
    tier: 1,
    description:
      'Reviewer — code review, security audit, best practices (at tier 1)',
  },
];

export interface OrchInitOptions {
  /** Project name (defaults to current directory name) */
  name?: string;
  /** Overwrite existing wrapper scripts and re-create agents */
  force?: boolean;
  /** Show what would be done without executing */
  dryRun?: boolean;
}

export interface OrchInitResult {
  step: string;
  status: 'ok' | 'skipped' | 'error' | 'would_execute';
  detail?: string;
}

// ── ORCH helpers ──

function findOrchBin(): string {
  const orchBin = process.env.ORCH_BIN;
  if (orchBin && existsSync(orchBin)) return orchBin;

  const nvmBin = `${homedir()}/.nvm/versions/node/v22.20.0/bin/orch`;
  if (existsSync(nvmBin)) return nvmBin;

  try {
    const which = execSync('which orch', { encoding: 'utf8', stdio: 'pipe' }).trim();
    if (which) return which;
  } catch {
    // not in PATH
  }

  return 'orch'; // fallback, let it fail naturally with a clear error
}

function orchExec(
  args: string[],
  cwd?: string,
): { stdout: string; stderr: string; status: number } {
  const bin = findOrchBin();
  const cmd = [bin, ...args].map((a) => `'${a.replace(/'/g, "'\\''")}'`).join(' ');
  try {
    const result = execSync(cmd, {
      encoding: 'utf8',
      stdio: 'pipe',
      cwd,
      timeout: 30000,
    });
    return { stdout: result, stderr: '', status: 0 };
  } catch (err: any) {
    return {
      stdout: err.stdout?.toString() ?? '',
      stderr: err.stderr?.toString() ?? err.message,
      status: err.status ?? 1,
    };
  }
}

/** Build the shell wrapper script content for a given ORCH role. */
function wrapperScript(role: OrchRole): string {
  return `#!/bin/bash
# ORCH shell agent: ${role.name} — delegates to at (tier ${role.tier})
# Generated by: at init
set -e
: "\${ORCHESTRY_TASK_PROMPT:?ORCHESTRY_TASK_PROMPT not set}"
printf '%s' "$ORCHESTRY_TASK_PROMPT" | at -t ${role.tier}
`;
}

function existingOrchAgentNames(): string[] {
  const indexPath = '.orchestry/agents/_index.json';
  if (!existsSync(indexPath)) return [];
  try {
    const index = JSON.parse(readFileSync(indexPath, 'utf8'));
    return index.map((a: any) => a.name.toLowerCase());
  } catch {
    return [];
  }
}

// ── ORCH init entry point ──

/**
 * Initialize an ORCH project in the current directory.
 *
 * Steps:
 * 1. Locate the `orch` binary
 * 2. Run `orch init --name <projectName>`
 * 3. Write shell wrapper scripts into .orchestry/wrappers/
 * 4. Create 4 agents (Arch, Dev, QA, Reviewer) via `orch agent add`
 *
 * Each wrapper script delegates to `at -t <tier> -s` using the
 * ORCHESTRY_TASK_PROMPT env var set by ORCH's shell adapter.
 */
export function runOrchInit(options: OrchInitOptions = {}): OrchInitResult[] {
  const results: OrchInitResult[] = [];
  const projectName = options.name ?? basename(process.cwd());
  const orchDir = '.orchestry';
  const wrappersDir = `${orchDir}/wrappers`;

  // ── Step 1: check orch binary ──
  const orchBin = findOrchBin();
  try {
    execSync(`"${orchBin}" --version`, { encoding: 'utf8', stdio: 'pipe' });
    results.push({ step: 'check orch', status: 'ok', detail: orchBin });
  } catch {
    results.push({
      step: 'check orch',
      status: 'error',
      detail:
        `orch not found at "${orchBin}". ` +
        'Install with: npm i -g @oxgeneral/orch',
    });
    return results;
  }

  // ── Step 2: orch init ──
  if (!existsSync(orchDir)) {
    if (options.dryRun) {
      results.push({
        step: 'orch init',
        status: 'would_execute',
        detail: `orch init --name "${projectName}"`,
      });
    } else {
      const r = orchExec(['init', '--name', projectName]);
      if (r.status !== 0) {
        results.push({
          step: 'orch init',
          status: 'error',
          detail: r.stderr || r.stdout || 'unknown error',
        });
        return results;
      }
      results.push({
        step: 'orch init',
        status: 'ok',
        detail: `.orchestry/ initialized for "${projectName}"`,
      });
    }
  } else {
    results.push({
      step: 'orch init',
      status: 'skipped',
      detail: '.orchestry/ already exists',
    });
  }

  // ── Step 3: create wrapper scripts ──
  if (!options.dryRun && !existsSync(wrappersDir)) {
    mkdirSync(wrappersDir, { recursive: true });
  }

  for (const role of ORCH_ROLES) {
    const wrapperPath = `${wrappersDir}/orch-${role.name.toLowerCase()}.sh`;

    if (existsSync(wrapperPath) && !options.force) {
      results.push({
        step: `wrapper: ${role.name}`,
        status: 'skipped',
        detail: `${wrapperPath} already exists (use --force to overwrite)`,
      });
      continue;
    }

    if (options.dryRun) {
      results.push({
        step: `wrapper: ${role.name}`,
        status: 'would_execute',
        detail: `would create ${wrapperPath}`,
      });
      continue;
    }

    writeFileSync(wrapperPath, wrapperScript(role), { mode: 0o755 });
    results.push({
      step: `wrapper: ${role.name}`,
      status: 'ok',
      detail: wrapperPath,
    });
  }

  // ── Step 4: create ORCH agents ──
  if (!options.dryRun && existsSync(orchDir)) {
    const existing = existingOrchAgentNames();

    for (const role of ORCH_ROLES) {
      const nameLower = role.name.toLowerCase();
      if (existing.includes(nameLower)) {
        results.push({
          step: `agent: ${role.name}`,
          status: 'skipped',
          detail: 'already registered in .orchestry/',
        });
        continue;
      }

      const wrapperPath = resolve(wrappersDir, `orch-${nameLower}.sh`);
      const r = orchExec([
        'agent', 'add', role.name,
        '--adapter', 'shell',
        '--role', role.description,
        '--command', wrapperPath,
        '--approval-policy', 'auto',
        '--timeout', '600000',
      ]);

      if (r.status !== 0) {
        results.push({
          step: `agent: ${role.name}`,
          status: 'error',
          detail: r.stderr || r.stdout || 'orch agent add failed',
        });
      } else {
        results.push({
          step: `agent: ${role.name}`,
          status: 'ok',
          detail: `shell adapter → at tier ${role.tier} (${wrapperPath})`,
        });
      }
    }
  }

  return results;
}

export function formatOrchInitResults(results: OrchInitResult[]): string {
  if (results.length === 0) return 'Nothing to do.';

  return results
    .map((r) => {
      const icon =
        r.status === 'ok'
          ? '✓'
          : r.status === 'skipped'
            ? '○'
            : r.status === 'error'
              ? '✗'
              : '→';
      const detail = r.detail ? ` — ${r.detail}` : '';
      return `  ${icon} ${r.step}${detail}`;
    })
    .join('\n');
}
