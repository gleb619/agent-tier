import type { NotifyAdapter, NotifyEvent } from '../types';
import { buildPromptSuffix } from '../prompt';

const TEXT_LIMIT = 500;

function truncate(s: string, n: number): string {
  if (s.length <= n) return s;
  return s.slice(0, n) + '…';
}

/**
 * kilo: `kilo run [--auto] --format json <message...>`.
 * Flags must appear before the prompt positional. The adapter inserts
 * `--format json` right before the trailing message.
 */
export function makeKiloAdapter(): NotifyAdapter {
  return {
    name: 'kilo',
    promptSuffix(ctx) {
      return buildPromptSuffix(ctx);
    },
    transformArgs(_ctx, baseArgs) {
      const out = baseArgs.slice(0, -1);
      out.push('--format', 'json');
      out.push(baseArgs[baseArgs.length - 1]!);
      return out;
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
        const part = (payload.part ?? {}) as Record<string, unknown>;
        if (t === 'step_start') {
          return [{ type: 'progress', text: 'session started' }];
        }
        if (t === 'text') {
          const text = typeof part.text === 'string' ? part.text : '';
          if (!text) return [];
          // kilo sends each text fragment; use `accumulated` if present so we
          // avoid duplicating earlier fragments.
          const acc = (payload as Record<string, unknown>).accumulated;
          const display = typeof acc === 'string' && acc ? acc : text;
          return [{ type: 'message', text: truncate(display, TEXT_LIMIT) }];
        }
        if (t === 'step_finish') {
          const reason = typeof part.reason === 'string' ? part.reason : 'finished';
          return [{ type: 'progress', text: `session ${reason}` }];
        }
        return [];
      } catch {
        return [];
      }
    },
  };
}