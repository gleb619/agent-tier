import { existsSync, readFileSync } from 'fs';
import path from 'path';
import os from 'os';

export interface FilterConfig {
  drop?: string[];
  groupRepeated?: boolean;
}

const BUILTIN_DROP_PATTERNS: string[] = [
  // ANSI escape sequences
  '^\\x1b\\[[0-9;]*[a-zA-Z]',
  // Spinner / progress bar characters
  "^[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏].*",
  // Carriage-return progress lines
  '^\\r',
  // Common noisy prefixes
  '^\\s*\\.+\\s*$',
];

export function loadFilterConfig(configPath?: string): FilterConfig {
  const paths = [];
  if (configPath) paths.push(configPath);
  paths.push(path.join(os.homedir(), '.config', 'chop', 'filters.json'));

  for (const p of paths) {
    if (existsSync(p)) {
      try {
        const raw = readFileSync(p, 'utf8');
        const parsed = JSON.parse(raw) as FilterConfig;
        return {
          drop: parsed.drop ?? [],
          groupRepeated: parsed.groupRepeated ?? true,
        };
      } catch {
        // ignore bad config
      }
    }
  }
  return {
    drop: BUILTIN_DROP_PATTERNS,
    groupRepeated: true,
  };
}

export function buildDropPatterns(config: FilterConfig): RegExp[] {
  const patterns = config.drop ?? BUILTIN_DROP_PATTERNS;
  return patterns.map((p) => {
    try {
      return new RegExp(p);
    } catch {
      return null;
    }
  }).filter((r): r is RegExp => r !== null);
}

export function shouldDrop(line: string, patterns: RegExp[]): boolean {
  for (const re of patterns) {
    if (re.test(line)) return true;
  }
  return false;
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

function extractErrorToolResults(content: unknown): string[] {
  if (!Array.isArray(content)) return [];
  const out: string[] = [];
  for (const b of content) {
    if (!b || typeof b !== 'object') continue;
    const block = b as { type?: string; is_error?: unknown; content?: unknown };
    if (block.type !== 'tool_result' || !block.is_error) continue;
    const c = block.content;
    if (typeof c === 'string') out.push(c);
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

/**
 * Convert one Claude Code stream-json line to a single human-readable line.
 * Returns null for non-JSON lines (caller should pass through) and for
 * stream-json events we don't want to display.
 */
export function renderStreamJsonLine(line: string): string | null {
  const trimmed = line.trim();
  if (!trimmed || trimmed[0] !== '{') return null;
  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(trimmed) as Record<string, unknown>;
  } catch {
    return null;
  }
  const t = payload.type;
  if (t === 'system') {
    const model = pluckString(payload, ['model']) ?? pluckString((payload.message as Record<string, unknown>) ?? {}, ['model']);
    return model ? `[system] session started (model=${model})` : '[system] session started';
  }
  if (t === 'assistant') {
    const msg = payload.message as { content?: unknown } | undefined;
    const content = msg?.content;
    const parts: string[] = [];
    for (const text of extractTextBlocks(content)) {
      parts.push(text.length > 500 ? text.slice(0, 500) + '…' : text);
    }
    for (const tu of extractToolUses(content)) {
      const summary = summarizeInput(tu.input);
      parts.push(summary ? `> ${tu.name} ${summary}` : `> ${tu.name}`);
    }
    if (parts.length === 0) return null;
    return parts.join('\n');
  }
  if (t === 'user') {
    const msg = payload.message as { content?: unknown } | undefined;
    const errors = extractErrorToolResults(msg?.content);
    if (errors.length === 0) return null;
    return errors.map((e) => `! ${e.length > 500 ? e.slice(0, 500) + '…' : e}`).join('\n');
  }
  if (t === 'result') {
    const parts: string[] = [];
    if ('num_turns' in payload) parts.push(`turns=${payload.num_turns}`);
    if ('duration_ms' in payload) parts.push(`dur=${payload.duration_ms}ms`);
    if ('total_cost_usd' in payload) parts.push(`cost=$${payload.total_cost_usd}`);
    const status = payload.is_error ? 'FAILED' : 'done';
    return `[result] ${status} ${parts.join(' ')}`.trim();
  }
  // codex JSONL events
  if (t === 'thread.started') return '[system] session started';
  if (t === 'turn.started') return null;
  if (t === 'turn.completed') return '[result] done';
  if (t === 'item.started' || t === 'item.completed') {
    const item = (payload as { item?: unknown }).item;
    if (!item || typeof item !== 'object') return null;
    const it = item as { type?: string; text?: string; command?: string; message?: string };
    if (t === 'item.completed' && it.type === 'agent_message') {
      return typeof it.text === 'string' && it.text ? it.text : null;
    }
    if (it.type === 'command_execution') {
      return it.command ? `> Bash ${it.command}` : '> Bash';
    }
    if (it.type === 'error') {
      return `! ${typeof it.message === 'string' ? it.message : 'error'}`;
    }
    if (it.type === 'reasoning') return null;
    return null;
  }
  // kimi stream-json events: role-tagged single messages
  const role = (payload as { role?: unknown }).role;
  if (role === 'assistant' && Array.isArray((payload as { content?: unknown }).content)) {
    const out: string[] = [];
    for (const b of (payload as { content: unknown[] }).content) {
      if (b && typeof b === 'object' && (b as { type?: string }).type === 'text') {
        const text = (b as { text?: unknown }).text;
        if (typeof text === 'string' && text) out.push(text);
      }
    }
    return out.length ? out.join('\n') : null;
  }
  // opencode --format json events: payload.type is the event class; payload.part
  // carries the structured record. Render only the noisy ones (text, step_finish).
  const ocPart = (payload as { part?: unknown }).part;
  if (ocPart && typeof ocPart === 'object') {
    const part = ocPart as { type?: string; text?: unknown; reason?: unknown };
    const ocType = payload.type;
    if (ocType === 'text' && typeof part.text === 'string' && part.text) return part.text;
    if (ocType === 'step_finish') {
      const reason = typeof part.reason === 'string' ? part.reason : 'stop';
      const status = reason === 'error' ? 'FAILED' : 'done';
      return `[result] ${status} reason=${reason}`;
    }
  }
  // pi --mode json events
  const piType = payload.type;
  if (piType === 'session') return '[system] session started';
  if (piType === 'agent_start') return null;
  if (piType === 'turn_start') return null;
  if (piType === 'message_start' || piType === 'message_end') {
    const m = (payload as { message?: unknown }).message;
    if (m && typeof m === 'object') {
      const msg = m as { role?: string; content?: unknown; errorMessage?: unknown };
      if (typeof msg.errorMessage === 'string' && msg.errorMessage) {
        return `! ${msg.errorMessage.length > 500 ? msg.errorMessage.slice(0, 500) + '…' : msg.errorMessage}`;
      }
      if (msg.role === 'assistant' && Array.isArray(msg.content)) {
        const out: string[] = [];
        for (const b of msg.content) {
          if (b && typeof b === 'object' && (b as { type?: string }).type === 'text') {
            const text = (b as { text?: unknown }).text;
            if (typeof text === 'string' && text) {
              out.push(text.length > 500 ? text.slice(0, 500) + '…' : text);
            }
          }
        }
        return out.length ? out.join('\n') : null;
      }
    }
    return null;
  }
  if (piType === 'turn_end') {
    const errMsg = (payload as { errorMessage?: unknown }).errorMessage;
    return `[result] ${typeof errMsg === 'string' && errMsg ? 'FAILED' : 'done'}`;
  }
  if (piType === 'agent_end' || piType === 'agent_settled') return null;
  // kiro --output-format stream-json events
  if (t === 'runStarted') {
    const data = (payload as { data?: unknown }).data;
    const engine = data && typeof data === 'object' && typeof (data as { engine?: unknown }).engine === 'string'
      ? (data as { engine: string }).engine
      : '';
    return engine ? `[system] session started (engine=${engine})` : '[system] session started';
  }
  if (t === 'runFinished') {
    const data = (payload as { data?: unknown }).data;
    if (!data || typeof data !== 'object') return '[result] done';
    const d = data as { status?: unknown; finalText?: unknown };
    const status = typeof d.status === 'string' ? d.status : 'done';
    const finalText = typeof d.finalText === 'string' ? d.finalText : '';
    const line = `[result] ${status}`;
    return finalText ? `${line}\n${finalText}` : line;
  }
  if (t === 'sessionUpdate') return null; // message chunks shown elsewhere
  if (t === 'metadata') return null;
  return null;
}

export interface ChopOptions {
  configPath?: string;
  groupRepeated?: boolean;
}

export function chopLines(logContent: string, opts: ChopOptions = {}): string {
  const config = loadFilterConfig(opts.configPath);
  const dropPatterns = buildDropPatterns(config);
  const groupRepeated = opts.groupRepeated ?? config.groupRepeated ?? true;

  const lines = logContent.split('\n');
  let lastLine: string | null = null;
  let repeatCount = 0;
  const outLines: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // Skip incomplete last line if content doesn't end with newline
    if (i === lines.length - 1 && !logContent.endsWith('\n') && line === '') {
      break;
    }
    if (shouldDrop(line, dropPatterns)) continue;
    if (groupRepeated) {
      if (line === lastLine) {
        repeatCount++;
        continue;
      }
      if (lastLine !== null && repeatCount > 1) {
        outLines.push(`  … (${repeatCount} times)`);
      }
      lastLine = line;
      repeatCount = 1;
    }
    outLines.push(line);
  }

  if (lastLine !== null && repeatCount > 1) {
    outLines.push(`  … (${repeatCount} times)`);
  }

  return outLines.join('\n');
}
