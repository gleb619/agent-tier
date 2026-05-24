import { existsSync } from 'fs';
import path from 'path';
import os from 'os';

const AT_DIR = '.at';
const HOME_AT_DIR = path.join(os.homedir(), '.at');

/**
 * Resolve the state directory:
 * 1. Explicit path (from --state-dir)
 * 2. .at/ in CWD if it contains state.json or runs.jsonl
 * 3. ~/.at/ (default)
 */
export function resolveStateDir(explicit?: string): string {
  if (explicit) return explicit;

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
