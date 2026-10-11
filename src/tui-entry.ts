import type { SpawnSyncReturns } from "node:child_process";
import { spawnSync } from "node:child_process";
import path from "node:path";

/**
 * Pick the TUI entry module for the no-arg `at` launch.
 *
 * Always returns `src/tui/index.tsx`. Extracted from `cli.ts` so the entry
 * path is unit-testable without spawning Bun.
 */
export function resolveTuiEntry(_env: NodeJS.ProcessEnv = process.env): string {
  return path.join(__dirname, "..", "src", "tui", "index.tsx");
}

/** Spawn the TUI entry under Bun with the opentui/solid preload. */
export function spawnTui(entry: string): SpawnSyncReturns<Buffer> {
  return spawnSync("bun", ["--preload", "@opentui/solid/preload", entry], {
    stdio: "inherit",
    timeout: 1800000,
  });
}
