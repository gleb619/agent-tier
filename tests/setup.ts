/**
 * Vitest global setup.
 * Sets AT_STATE_DIR to a unique temp directory per test run so tests
 * never pollute real ~/.at/runs.jsonl.
 */
import { mkdirSync, rmSync, writeFileSync } from 'fs';
import path from 'path';
import os from 'os';

// Set AT_STATE_DIR at module level — before any imports resolve
process.env.AT_STATE_DIR = path.join(os.tmpdir(), `at-test-${process.pid}`);

const atDir = process.env.AT_STATE_DIR;

beforeAll(() => {
  mkdirSync(atDir, { recursive: true });
  writeFileSync(path.join(atDir, 'state.json'), '{}', 'utf8');
});

afterAll(() => {
  rmSync(atDir, { recursive: true, force: true });
  delete process.env.AT_STATE_DIR;
});
