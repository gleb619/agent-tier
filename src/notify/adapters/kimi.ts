import type { NotifyAdapter, NotifyEvent } from '../types';

const TEXT_LIMIT = 500;

function truncate(s: string, n: number): string {
  if (s.length <= n) return s;
  return s.slice(0, n) + '…';
}

function summarizeToolArgs(argumentsJson: string): string {
  try {
    const parsed = JSON.parse(argumentsJson) as Record<string, unknown>;
    for (const k of ['path', 'command', 'file_path', 'query', 'url', 'description', 'pattern']) {
      const v = parsed[k];
      if (typeof v === 'string' && v) return v;
    }
    const json = JSON.stringify(parsed);
    return json.length <= 80 ? json : json.slice(0, 77) + '…';
  } catch {
    return argumentsJson.length <= 80 ? argumentsJson : argumentsJson.slice(0, 77) + '…';
  }
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

function extractToolContent(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .map((b) => {
      if (!b || typeof b !== 'object') return '';
      const block = b as { type?: string; text?: unknown };
      return block.type === 'text' && typeof block.text === 'string' ? block.text : '';
    })
    .filter(Boolean)
    .join('\n');
}

function isErrorContent(text: string): boolean {
  return /\b(error|failed|ENOENT|exception|traceback)\b/i.test(text);
}

export function makeKimiAdapter(): NotifyAdapter {
  return {
    name: 'kimi',
    promptSuffix() {
      return '';
    },
    // kimi requires --print --output-format stream-json BEFORE -p <prompt>.
    // Drop the trailing -p <prompt> from baseArgs, then prepend the flags.
    transformArgs(_ctx, baseArgs) {
      const prompt = baseArgs[baseArgs.length - 1]!;
      const head = baseArgs.slice(0, -2).filter((a) => a !== '-p' && a !== '--prompt');
      return [
        ...head,
        '--print',
        '--output-format', 'stream-json',
        '-p', prompt,
      ];
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
        const role = payload.role;
        if (role === 'assistant') {
          const events: Array<Omit<NotifyEvent, 'runId' | 'agent' | 'ts' | 'seq'>> = [];
          for (const text of extractTextBlocks(payload.content)) {
            events.push({ type: 'message', text: truncate(text, TEXT_LIMIT) });
          }
          const toolCalls = payload.tool_calls;
          if (Array.isArray(toolCalls)) {
            for (const tc of toolCalls) {
              if (!tc || typeof tc !== 'object') continue;
              const fn = (tc as { function?: unknown }).function;
              if (!fn || typeof fn !== 'object') continue;
              const f = fn as { name?: unknown; arguments?: unknown };
              const name = typeof f.name === 'string' ? f.name : 'tool';
              const args = typeof f.arguments === 'string' ? f.arguments : '';
              const summary = summarizeToolArgs(args);
              const label = summary ? `${name} ${summary}` : name;
              events.push({
                type: 'tool',
                text: truncate(label, TEXT_LIMIT),
                data: { name },
              });
            }
          }
          return events;
        }
        if (role === 'tool') {
          const text = extractToolContent(payload.content);
          if (text && isErrorContent(text)) {
            return [{ type: 'error', text: truncate(text, TEXT_LIMIT) }];
          }
          return [];
        }
        return [];
      } catch {
        return [];
      }
    },
  };
}