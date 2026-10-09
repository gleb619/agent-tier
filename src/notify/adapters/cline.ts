import type { NotifyAdapter, NotifyEvent } from '../types';

const TEXT_LIMIT = 500;

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
 * cline: `--json` flag already added in buildArgs. Emits:
 *   {ts, type:"agent_event", event:{type:"content_start"|"tool_start"|..., contentType, text, accumulated}}
 *   {ts, type:"agent_event", event:{type:"iteration_end", iteration, hadToolCalls, toolCallCount}}
 *   {ts, type:"agent_event", event:{type:"done", reason, text}}
 *   {ts, type:"run_result", finishReason, text, iterations, durationMs}
 */
export function makeClineAdapter(): NotifyAdapter {
  return {
    name: 'cline',
    promptSuffix() {
      return '';
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