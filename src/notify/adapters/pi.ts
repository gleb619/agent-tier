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

function getMessage(payload: Record<string, unknown>): Record<string, unknown> | undefined {
  const m = payload.message;
  if (m && typeof m === 'object') return m as Record<string, unknown>;
  return undefined;
}

function extractTextBlocks(content: unknown): string[] {
  if (!Array.isArray(content)) return [];
  const out: string[] = [];
  for (const b of content) {
    if (!b || typeof b !== 'object') continue;
    const block = b as { type?: string; text?: unknown };
    if (block.type === 'text' && typeof block.text === 'string' && block.text) {
      out.push(block.text);
    }
  }
  return out;
}

function extractToolUses(content: unknown): Array<{ name: string; input: unknown }> {
  if (!Array.isArray(content)) return [];
  const out: Array<{ name: string; input: unknown }> = [];
  for (const b of content) {
    if (!b || typeof b !== 'object') continue;
    const block = b as { type?: string; name?: string; input?: unknown };
    if (block.type === 'tool_use' && typeof block.name === 'string') {
      out.push({ name: block.name, input: block.input });
    }
  }
  return out;
}

function pluckString(obj: Record<string, unknown>, keys: string[]): string | undefined {
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === 'string' && v) return v;
  }
  return undefined;
}

export function makePiAdapter(): NotifyAdapter {
  return {
    name: 'pi',
    promptSuffix() {
      return '';
    },
    // pi flag order: -p --provider X --model Y --no-session --mode json <prompt>
    // baseArgs ends with the prompt; insert --mode json just before it.
    transformArgs(_ctx, baseArgs) {
      const out = baseArgs.slice(0, -1);
      out.push('--mode', 'json');
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

        if (t === 'session') {
          const id = pluckString(payload, ['id']);
          const data: Record<string, unknown> = {};
          if (id) data.session_id = id;
          return [{ type: 'progress', text: 'session started', data }];
        }
        if (t === 'agent_start' || t === 'turn_start') {
          return [{ type: 'progress', text: t === 'agent_start' ? 'agent started' : 'turn started' }];
        }
        if (t === 'message_start' || t === 'message_end') {
          const message = getMessage(payload);
          if (!message) return [];
          const role = message.role;
          if (role !== 'assistant') return [];
          const content = message.content;
          const errMsg = pluckString(message, ['errorMessage']);
          if (errMsg) {
            return [{ type: 'error', text: truncate(errMsg, TEXT_LIMIT) }];
          }
          const events: Array<Omit<NotifyEvent, 'runId' | 'agent' | 'ts' | 'seq'>> = [];
          for (const text of extractTextBlocks(content)) {
            events.push({ type: 'message', text: truncate(text, TEXT_LIMIT) });
          }
          for (const tu of extractToolUses(content)) {
            const summary = summarizeInput(tu.input);
            const label = summary ? `${tu.name} ${summary}` : tu.name;
            events.push({ type: 'tool', text: truncate(label, TEXT_LIMIT), data: { name: tu.name } });
          }
          return events;
        }
        if (t === 'turn_end') {
          const errMsg = pluckString(payload, ['errorMessage']);
          const stopReason = pluckString(payload, ['stopReason']);
          const data: Record<string, unknown> = {};
          if (stopReason) data.stopReason = stopReason;
          if (errMsg) data.errorMessage = errMsg;
          const status = errMsg ? 'FAILED' : 'done';
          return [{ type: 'progress', text: `[result] ${status}`, data }];
        }
        if (t === 'agent_end') {
          return [{ type: 'progress', text: 'agent ended' }];
        }
        if (t === 'agent_settled') {
          return [{ type: 'progress', text: 'session settled' }];
        }
        return [];
      } catch {
        return [];
      }
    },
  };
}
