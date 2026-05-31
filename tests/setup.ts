/**
 * Vitest global setup.
 * Creates .at/ directory at project root so resolveStateDir()
 * finds local state instead of falling back to ~/.at/.
 */
import { mkdirSync, rmSync, existsSync, writeFileSync } from 'fs';
import path from 'path';

const projectRoot = path.resolve(__dirname, '..');
const atDir = path.join(projectRoot, '.at');

beforeAll(() => {
  mkdirSync(atDir, { recursive: true });
  // Seed minimal state.json so resolveStateDir detects .at/
  const stateFile = path.join(atDir, 'state.json');
  if (!existsSync(stateFile)) {
    writeFileSync(stateFile, '{}', 'utf8');
  }
});

afterAll(() => {
  // Reset to empty state — don't delete the dir itself
  const stateFile = path.join(atDir, 'state.json');
  if (existsSync(stateFile)) {
    writeFileSync(stateFile, '{}', 'utf8');
  }
  // Clean up any lock files
  const locksDir = path.join(atDir, 'locks');
  if (existsSync(locksDir)) {
    rmSync(locksDir, { recursive: true, force: true });
  }
  // Clean up runs.jsonl if created
  const runsFile = path.join(atDir, 'runs.jsonl');
  if (existsSync(runsFile)) {
    rmSync(runsFile, { force: true });
  }
});
