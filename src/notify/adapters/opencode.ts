import type { NotifyAdapter, NotifyEvent } from '../types';

const TEXT_LIMIT = 500;

function truncate(s: string, n: number): string {
  if (s.length <= n) return s;
  return s.slice(0, n) + '…';
}

function summarizeInput(input: unknown): string {
  if (!input || typeof input !== 'object') return '';
  const obj = input as Record<string, unknown>;
  for (const k of ['file_path', 'path', 'pattern', 'command', 'query', 'url', 'description']) {
    const v = obj[k];
    if (typeof v === 'string' && v) return v;
  }
  try {
    const json = JSON.stringify(input);
    if (json.length <= 80) return json;
    return json.slice(0, 77) + '…';
  } catch {
    return '';
  }
}

function getPart(payload: Record<string, unknown>): Record<string, unknown> | undefined {
  const p = payload.part;
  if (p && typeof p === 'object') return p as Record<string, unknown>;
  return undefined;
}

function pluckString(obj: Record<string, unknown>, keys: string[]): string | undefined {
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === 'string' && v) return v;
  }
  return undefined;
}

export function makeOpenCodeAdapter(): NotifyAdapter {
  return {
    name: 'opencode',
    promptSuffix() {
      return '';
    },
    // opencode flag order: run [...] --format json <prompt>
    // baseArgs ends with the prompt; insert --format json just before it.
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
        const part = getPart(payload);

        // Text part with payload-level type="text"
        if (t === 'text' && part) {
          const text = part.text;
          if (typeof text === 'string' && text) {
            return [{ type: 'message', text: truncate(text, TEXT_LIMIT) }];
          }
          return [];
        }

        // Step / lifecycle
        if (t === 'step_start') {
          return [{ type: 'progress', text: 'step started' }];
        }
        if (t === 'step_finish') {
          const reason = pluckString(part ?? {}, ['reason']) ?? 'stop';
          const tokens = part && typeof part.tokens === 'object' ? (part.tokens as Record<string, unknown>) : undefined;
          const cost = part && typeof part.cost === 'number' ? (part.cost as number) : undefined;
          const data: Record<string, unknown> = {};
          if (reason) data.reason = reason;
          if (tokens) data.tokens = tokens;
          if (typeof cost === 'number') data.cost = cost;
          const status = reason === 'error' ? 'FAILED' : 'done';
          return [{ type: 'progress', text: `[result] ${status} reason=${reason}`, data }];
        }

        // Tool parts: payload.type may be tool call shapes
        if (typeof t === 'string' && t.startsWith('tool')) {
          if (!part) return [];
          const toolName = pluckString(part, ['tool', 'name']) ?? t;
          const input = (part as { input?: unknown }).input;
          const summary = summarizeInput(input);
          const label = summary ? `${toolName} ${summary}` : toolName;
          return [{ type: 'tool', text: truncate(label, TEXT_LIMIT), data: { name: toolName } }];
        }

        // Generic error payload
        if (t === 'error') {
          const msg = pluckString(part ?? {}, ['message', 'error']) ?? 'opencode error';
          return [{ type: 'error', text: truncate(msg, TEXT_LIMIT) }];
        }

        return [];
      } catch {
        return [];
      }
    },
  };
}
