import path from 'path';
import { spawnSync } from 'child_process';
import type { SpawnSyncReturns } from 'child_process';

/**
 * Pick the TUI entry module for the no-arg `at` launch.
 *
 * `AT_EXPERIMENTAL_TUI=1` opts into the experimental two-column TUI
 * (`src/tui2/`); unset (or any other value) keeps the classic TUI
 * (`src/tui/`). Extracted from `cli.ts` so the switch is unit-testable
 * without spawning Bun.
 */
export function resolveTuiEntry(env: NodeJS.ProcessEnv = process.env): string {
  const variant = env.AT_EXPERIMENTAL_TUI === '1' ? 'tui2' : 'tui';
  return path.join(__dirname, '..', 'src', variant, 'index.tsx');
}

/** Spawn the TUI entry under Bun with the opentui/solid preload. */
export function spawnTui(entry: string): SpawnSyncReturns<Buffer> {
  return spawnSync('bun', ['--preload', '@opentui/solid/preload', entry], {
    stdio: 'inherit',
    timeout: 1800000,
  });
}
