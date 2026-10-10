import type { NotifyAdapter, NotifyEvent, NotifyAdapterContext } from '../types';

const TEXT_LIMIT = 500;
const MESSAGE_THROTTLE_MS = 1000;

function truncate(s: string, n: number): string {
  if (s.length <= n) return s;
  return s.slice(0, n) + '…';
}

interface ClineEvent {
  type?: string;
  contentType?: string;
  text?: string;
  accumulated?: string;
  reason?: string;
}

/**
 * Base executable for host-channel commands. Prefers the per-run shim: the
 * cline v3 hub daemon keeps a stale env (AT_STATE_DIR / AT_RUN_ID captured
 * at first start), so a bare `at` subprocess lands in the wrong state dir.
 * The shim sets the right env and execs `at` regardless of daemon env.
 */
function atBase(ctx: NotifyAdapterContext): string {
  return ctx.hostChannelShim ?? ctx.atBin ?? '$AT_BIN';
}

/** Flags for `discuss ask`: -R always; --state-dir only when no shim. */
function askFlags(ctx: NotifyAdapterContext): string {
  const { runId, stateDir, hostChannelShim } = ctx;
  const state = !hostChannelShim && stateDir ? ` --state-dir ${stateDir}` : '';
  return `${state} -R ${runId}`;
}

function buildClineInstructions(ctx: NotifyAdapterContext): string {
  const { runId, stateDir } = ctx;
  const base = atBase(ctx);
  return `Host channel: this run ID is ${runId}; state dir is ${stateDir}. Run the following command to ask the host a question and get an answer:

  ${base} discuss ask "<question>" -o <option1> -o <option2>${askFlags(ctx)}

Replace "<question>" with your question, and "<option1>" / "<option2>" with the answer options. The command blocks until the host answers and prints the answer to stdout.

To post a milestone note, run:

  ${base} discuss note "<message>"

Check for new host instructions at milestones by running:

  ${base} discuss inbox
`;
}

/**
 * Build a cline-specific prompt suffix. Cline v3 spawns its tool subprocesses
 * inside a long-running hub daemon that doesn't inherit the runner's
 * `AT_BIN` / `AT_STATE_DIR` env. The LLM therefore cannot resolve `$AT_BIN`
 * or guess the right state dir — the previous shared suffix made cline
 * spend 4-5 iterations hunting for the `at` binary before it ever issued a
 * single discuss call, and the bash subprocess it eventually used wrote
 * to a different state dir than the host, so the host's answer never
 * landed on the LLM's thread.
 *
 * The single example command below inlines the actual `at` path, the real
 * `--state-dir` and `-R` values for this run, and a concrete question
 * template. That makes the host channel work on the first iteration and
 * keeps the LLM from improvising an alternate path.
 *
 * Cline's suffix REPLACES the shared `DISCUSS_INSTRUCTION` rather than
 * appending to it — when both are present, the LLM tends to follow the
 * shared `$AT_BIN discuss ask ...` form (which omits the state dir and
 * run id) and the cline-specific rules get ignored.
 */
function clinePromptSuffix(ctx: NotifyAdapterContext): string {
  const { runId, atBin, stateDir, hostChannelShim } = ctx;
  // Prefer the per-run shim when present: cline v3's hub daemon keeps a
  // stale env that ignores our spawn-time AT_STATE_DIR / AT_RUN_ID, so a
  // bare `at discuss ask` lands in the wrong state dir. The shim is a
  // self-contained wrapper that sets the right env and execs `at` — it
  // works no matter what env the daemon has captured.
  const cmd = hostChannelShim
    ? `${hostChannelShim} discuss ask "<question>" -o <opt1> -o <opt2> -R ${runId}`
    : `${atBin ?? '$AT_BIN'} discuss ask "<question>" -o <opt1> -o <opt2>${stateDir ? ` --state-dir ${stateDir}` : ''} -R ${runId}`;
  return (
    '\n\nHost channel — use this exact one-line command, do NOT improvise:\n' +
    `    ${cmd}\n` +
    'It blocks until the host answers, then prints the answer on stdout. That stdout line IS the answer. Do not list, poll, retry, or read source code. When done, write the result to color.txt and stop.'
  );
}

/**
 * cline: `--json` flag already added in buildArgs. Emits:
 *   {ts, type:"agent_event", event:{type:"content_start"|"tool_start"|..., contentType, text, accumulated}}
 *   {ts, type:"agent_event", event:{type:"iteration_end", iteration, hadToolCalls, toolCallCount}}
 *   {ts, type:"agent_event", event:{type:"done", reason, text}}
 *   {ts, type:"run_result", finishReason, text, iterations, durationMs}
 */
export function makeClineAdapter(): NotifyAdapter {
  let lastMessageAt = 0;
  return {
    name: 'cline',
    promptPrefix(ctx) {
      return buildClineInstructions(ctx);
    },
    promptSuffix(ctx) {
      return clinePromptSuffix(ctx);
    },
    parseLine(line: string): Array<Omit<NotifyEvent, 'runId' | 'agent' | 'ts' | 'seq'>> {
      try {
        const trimmed = line.trim();
        if (!trimmed || trimmed[0] !== '{') return [];
        let payload: Record<string, unknown>;
        try {
          payload = JSON.parse(trimmed) as Record<string, unknown>;
        } catch {
          return [];
        }
        const t = payload.type;
        if (t === 'agent_event') {
          const ev = (payload.event ?? {}) as ClineEvent;
          if (ev.type === 'iteration_start') {
            return [{ type: 'progress', text: 'session started' }];
          }
          if (ev.type === 'content_start' && ev.contentType === 'text') {
            const acc = typeof ev.accumulated === 'string' ? ev.accumulated : '';
            const text = typeof ev.text === 'string' ? ev.text : '';
            const display = acc || text;
            if (!display) return [];
            const now = Date.now();
            if (now - lastMessageAt < MESSAGE_THROTTLE_MS) return [];
            lastMessageAt = now;
            return [{ type: 'message', text: truncate(display, TEXT_LIMIT) }];
          }
          if (ev.type === 'tool_start' || ev.type === 'tool_call') {
            const text = typeof ev.text === 'string' ? ev.text : 'tool call';
            return [{ type: 'tool', text: truncate(text, TEXT_LIMIT) }];
          }
          if (ev.type === 'done') {
            return [{ type: 'progress', text: `session done (${ev.reason ?? 'completed'})` }];
          }
          return [];
        }
        if (t === 'run_result') {
          const parts: string[] = [];
          if (typeof payload.durationMs === 'number') parts.push(`dur=${payload.durationMs}ms`);
          if (typeof payload.iterations === 'number') parts.push(`iterations=${payload.iterations}`);
          const events: Array<Omit<NotifyEvent, 'runId' | 'agent' | 'ts' | 'seq'>> = [{
            type: 'progress',
            text: `[result] ${payload.finishReason ?? 'done'} ${parts.join(' ')}`.trim(),
          }];
          const text = typeof payload.text === 'string' ? payload.text : '';
          if (text) events.push({ type: 'message', text: truncate(text, TEXT_LIMIT) });
          return events;
        }
        return [];
      } catch {
        return [];
      }
    },
  };
}