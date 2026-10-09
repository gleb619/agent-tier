import type { NotifyAdapter, NotifyEvent } from '../types';
import { buildPromptSuffix } from '../prompt';

const TEXT_LIMIT = 500;

function truncate(s: string, n: number): string {
  if (s.length <= n) return s;
  return s.slice(0, n) + '…';
}

function summarizeArgs(command: string): string {
  return command;
}

interface CodexItem {
  id?: string;
  type?: string;
  message?: string;
  text?: string;
  command?: string;
  aggregated_output?: string;
  exit_code?: number | null;
  status?: string;
  path?: string;
  kind?: string;
  query?: string;
  name?: string;
}

function getItem(payload: Record<string, unknown>): CodexItem | undefined {
  const direct = payload.item;
  if (direct && typeof direct === 'object') return direct as CodexItem;
  return undefined;
}

export function makeCodexAdapter(): NotifyAdapter {
  return {
    name: 'codex',
    promptSuffix(ctx) {
      return buildPromptSuffix(ctx);
    },
    // codex flags must go BEFORE the prompt; buildArgs returns
    // ['exec', '--yolo', '--skip-git-repo-check', <prompt>] so insert
    // '--json' right before the last element.
    transformArgs(_ctx, baseArgs) {
      const out = baseArgs.slice(0, -1);
      out.push('--json');
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
        if (t === 'thread.started') {
          const data: Record<string, unknown> = {};
          if (typeof payload.thread_id === 'string') data.thread_id = payload.thread_id;
          return [{ type: 'progress', text: 'session started', data }];
        }
        if (t === 'turn.started') {
          return [{ type: 'progress', text: 'turn started' }];
        }
        if (t === 'turn.completed') {
          const data: Record<string, unknown> = {};
          if ('usage' in payload) data.usage = payload.usage;
          return [{ type: 'progress', text: 'turn finished', data }];
        }
        if (t === 'item.started' || t === 'item.completed') {
          const item = getItem(payload);
          if (!item) return [];
          return mapItem(t === 'item.completed', item);
        }
        return [];
      } catch {
        return [];
      }
    },
  };
}

function mapItem(
  completed: boolean,
  item: CodexItem,
): Array<Omit<NotifyEvent, 'runId' | 'agent' | 'ts' | 'seq'>> {
  switch (item.type) {
    case 'agent_message': {
      const text = typeof item.text === 'string' ? item.text : '';
      if (!text) return [];
      return [{ type: 'message', text: truncate(text, TEXT_LIMIT) }];
    }
    case 'reasoning': {
      return completed
        ? [{ type: 'progress', text: 'reasoning' }]
        : [{ type: 'progress', text: 'reasoning…' }];
    }
    case 'command_execution': {
      const cmd = typeof item.command === 'string' ? item.command : '';
      const status = typeof item.status === 'string' ? item.status : '';
      const data: Record<string, unknown> = { name: 'Bash' };
      if (typeof item.exit_code === 'number') data.exit_code = item.exit_code;
      if (status) data.status = status;
      const label = completed
        ? `Bash ${summarizeArgs(cmd)}`
        : `Bash ${summarizeArgs(cmd)}…`;
      return [{ type: 'tool', text: truncate(label, TEXT_LIMIT), data }];
    }
    case 'file_change': {
      const path = typeof item.path === 'string' ? item.path : '';
      const kind = typeof item.kind === 'string' ? item.kind : 'change';
      const label = path ? `File ${kind} ${path}` : `File ${kind}`;
      return [{ type: 'tool', text: truncate(label, TEXT_LIMIT), data: { name: 'FileChange' } }];
    }
    case 'web_search': {
      const query = typeof item.query === 'string' ? item.query : '';
      const label = query ? `WebSearch ${query}` : 'WebSearch';
      return [{ type: 'tool', text: truncate(label, TEXT_LIMIT), data: { name: 'WebSearch' } }];
    }
    case 'mcp_tool_call': {
      const name = typeof item.name === 'string' ? item.name : 'MCP';
      const label = `MCP ${name}`;
      return [{ type: 'tool', text: truncate(label, TEXT_LIMIT), data: { name } }];
    }
    case 'error': {
      const msg = typeof item.message === 'string' ? item.message : 'codex error';
      return [{ type: 'error', text: truncate(msg, TEXT_LIMIT) }];
    }
    default:
      return [];
  }
}