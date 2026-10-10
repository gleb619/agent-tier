/**
 * Run naming — the one place that turns a prompt into a persisted
 * `RunRecord.name`.
 *
 * Two callers share this path:
 *  - `runner.run()` in blocking modes (`-s`, `--wait`, `--sse`), where the CLI
 *    process outlives the agent and awaits the result before returning;
 *  - `run-watch.main()` for the default detached run, where the CLI exits right
 *    after the run box and the supervisor is the only process left alive.
 *
 * Never throws: naming is enrichment, so any failure resolves to `null` and the
 * run keeps its `UNNAMED_PLACEHOLDER` name.
 */
import { appendFileSync } from 'fs';

import { generateSessionName } from './namer';
import { updateRun } from './run-store';

export interface ApplyRunNameOpts {
  stateDir: string;
  runId: string;
  prompt: string;
  /** When set, the winning provider is appended to the run log (supervisor path). */
  logFile?: string;
  signal?: AbortSignal;
}

export interface AppliedRunName {
  name: string;
  provider: string;
}

export async function applyRunName(opts: ApplyRunNameOpts): Promise<AppliedRunName | null> {
  if (!opts.prompt || !opts.prompt.trim()) return null;
  try {
    const result = await generateSessionName(
      opts.prompt,
      opts.stateDir,
      opts.signal ? { signal: opts.signal } : {},
    );
    // provider === null means every namer failed and we got the fallback name —
    // the record already says `unnamed`, so there is nothing to write.
    if (!result.provider) return null;
    await updateRun(opts.stateDir, opts.runId, { name: result.name });
    if (opts.logFile) {
      try {
        appendFileSync(opts.logFile, `[at] namer: ${result.name} (via ${result.provider})\n`);
      } catch {
        // log file may be gone — the run record is what matters
      }
    }
    return { name: result.name, provider: result.provider };
  } catch {
    return null;
  }
}
