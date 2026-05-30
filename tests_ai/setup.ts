import { execSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

export const DEFAULT_TIMEOUT = 120000;

const NODE_BIN = process.env.NODE_BIN ?? path.dirname(process.execPath);
const LOCAL_BIN = process.env.LOCAL_BIN ?? `${process.env.HOME}/.local/bin`;

export interface Sandbox {
  dir: string;
}

export function createSandbox(): Sandbox {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'at-test-'));
  
  execSync('git init -q', { cwd: dir });
  fs.writeFileSync(path.join(dir, 'main.js'), '// placeholder\n');
  fs.writeFileSync(path.join(dir, '.gitignore'), 'node_modules/\n');
  execSync('git add -A', { cwd: dir });
  execSync('git commit -q -m "init" --author="Test <test@test.com>"', { cwd: dir });
  
  return { dir };
}

export function cleanupSandbox(sandbox: Sandbox): void {
  if (sandbox.dir && fs.existsSync(sandbox.dir)) {
    fs.rmSync(sandbox.dir, { recursive: true, force: true });
  }
}

export function agentBinExists(agent: string): boolean {
  let binPath = '';

  switch (agent) {
    case 'glm-code':  binPath = process.env.GLM_CODE_BIN ?? `${LOCAL_BIN}/glm-code`; break;
    case 'codex':     binPath = process.env.CODEX_BIN ?? `${NODE_BIN}/codex`; break;
    case 'kimi':      binPath = process.env.KIMI_BIN ?? `${NODE_BIN}/kimi`; break;
    case 'blackbox':  binPath = process.env.BLACKBOX_BIN ?? `${LOCAL_BIN}/blackbox`; break;
    case 'opencode':  binPath = process.env.OPENCODE_BIN ?? `${NODE_BIN}/opencode`; break;
    case 'qwen':      binPath = process.env.QWEN_BIN ?? `${NODE_BIN}/qwen`; break;
    case 'kilo':      binPath = process.env.KILO_BIN ?? `${NODE_BIN}/kilo`; break;
    case 'gemini':    binPath = process.env.GEMINI_BIN ?? `${NODE_BIN}/gemini`; break;
    case 'goose':     binPath = process.env.GOOSE_BIN ?? `${LOCAL_BIN}/goose`; break;
    case 'aider':     binPath = process.env.AIDER_BIN ?? `${LOCAL_BIN}/aider`; break;
    case 'pi':        binPath = process.env.PI_BIN ?? `${NODE_BIN}/pi`; break;
    case 'cursor':    binPath = process.env.CURSOR_BIN ?? `${LOCAL_BIN}/cursor-agent`; break;
    case 'cline':     binPath = process.env.CLINE_BIN ?? `${NODE_BIN}/cline`; break;
    case 'mock':      binPath = process.env.MOCK_BIN ?? `${LOCAL_BIN}/mock-agent`; break;
    case 'mock-long': binPath = process.env.MOCK_LONG_BIN ?? `${LOCAL_BIN}/mock-long-agent`; break;
    default:          return false;
  }

  try {
    fs.accessSync(binPath, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

export function isAgentEnabled(agent: string): boolean {
  try {
    const statePath = path.join(os.homedir(), '.at', 'state.json');
    if (!fs.existsSync(statePath)) return true;
    const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
    const agentState = state.agents?.[agent];
    if (agentState?.deactivated) return false;
    if (agentState?.disabledTo && new Date(agentState.disabledTo) > new Date()) return false;
    return true;
  } catch {
    return true;
  }
}

export function getCliPath(): string {
  return path.resolve(__dirname, '../dist/cli.js');
}