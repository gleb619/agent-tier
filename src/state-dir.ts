import { existsSync } from 'fs';
import path from 'path';
import os from 'os';

const AT_DIR = '.at';
const HOME_AT_DIR = path.join(os.homedir(), '.at');

/**
 * Walk up from `startDir` to find the nearest directory containing `.git/`.
 * Returns `undefined` if no git root found.
 */
export function findProjectRoot(startDir: string): string | undefined {
  let dir = path.resolve(startDir);
  const root = path.parse(dir).root;

  while (dir !== root) {
    if (existsSync(path.join(dir, '.git'))) {
      return dir;
    }
    dir = path.dirname(dir);
  }

  // Check root itself
  if (existsSync(path.join(root, '.git'))) {
    return root;
  }

  return undefined;
}

/**
 * Resolve the state directory:
 * 1. Explicit path (from --state-dir)
 * 2. .at/ in project root (git root) if it contains state.json or runs.jsonl
 * 3. .at/ in CWD if it contains state.json or runs.jsonl
 * 4. ~/.at/ (default)
 */
export function resolveStateDir(explicit?: string): string {
  if (explicit) return explicit;

  // Allow tests (and users) to override via env var
  if (process.env.AT_STATE_DIR) return process.env.AT_STATE_DIR;

  // Check project root (git root)
  const projectRoot = findProjectRoot(process.cwd());
  if (projectRoot) {
    const projectAt = path.join(projectRoot, AT_DIR);
    if (existsSync(path.join(projectAt, 'state.json')) || existsSync(path.join(projectAt, 'runs.jsonl'))) {
      return projectAt;
    }
  }

  // Check CWD
  const cwdAt = path.join(process.cwd(), AT_DIR);
  if (existsSync(path.join(cwdAt, 'state.json')) || existsSync(path.join(cwdAt, 'runs.jsonl'))) {
    return cwdAt;
  }

  return HOME_AT_DIR;
}

export function getStateFilePath(stateDir: string): string {
  return path.join(stateDir, 'state.json');
}

export function getRunsFilePath(stateDir: string): string {
  return path.join(stateDir, 'runs.jsonl');
}
