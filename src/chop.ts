import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'fs';
import path from 'path';
import os from 'os';
import { spawn, spawnSync } from 'child_process';
import { randomUUID } from 'crypto';

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

// ---------------------------------------------------------------------------
// Buffered compression via the external `chop` CLI (https://github.com/AgusRdz/chop)
// ---------------------------------------------------------------------------

/** Official installer script for the `chop` binary. */
export const CHOP_INSTALL_SCRIPT_URL = 'https://raw.githubusercontent.com/AgusRdz/chop/main/install.sh';

/** Env var that overrides the isolated `chop` install directory. */
export const CHOP_INSTALL_DIR_ENV = 'AT_CHOP_DIR';

const CHOP_DEFAULT_TIMEOUT_MS = 30_000;

function warnChop(message: string): void {
  process.stderr.write(`[at] chop: ${message}\n`);
}

function firstLine(text: string): string {
  const line = text.trim().split('\n')[0];
  return line ? `: ${line}` : '';
}

function withTrailingNewline(text: string): string {
  return text.endsWith('\n') ? text : `${text}\n`;
}

/** Isolated install dir for the `chop` binary (`~/.at/chop` unless overridden). */
export function resolveChopInstallDir(): string {
  const envDir = process.env[CHOP_INSTALL_DIR_ENV];
  if (envDir) return envDir;
  return path.join(os.homedir(), '.at', 'chop');
}

/** Returns `'chop'` when a usable binary sits on PATH, else `null`. Result is not cached. */
export function findChopOnPath(): string | null {
  try {
    const res = spawnSync('chop', ['version'], { stdio: 'ignore' });
    return res.error ? null : 'chop';
  } catch {
    return null;
  }
}

export interface ChopLoggerOptions {
  /** Where the isolated `chop` binary lives (default: `AT_CHOP_DIR` or `~/.at/chop`). */
  installDir?: string;
  /** Timeout for installer / `chop cat` runs (default: 30s). */
  timeoutMs?: number;
}

/**
 * Buffers log lines and compresses them in one batch through the external
 * `chop` CLI. The binary is kept in an isolated directory (`~/.at/chop`) so the
 * user's global environment is untouched; when it is missing or fails the raw
 * output is printed verbatim — the CLI never breaks because of chop.
 */
export class ChopLogger {
  private buffer: string[] = [];
  private readonly installDir: string;
  private readonly chopBinPath: string;
  private readonly timeoutMs: number;
  private pathChop: string | null | undefined;
  private installAttempted = false;
  private installOk = false;

  constructor(opts: string | ChopLoggerOptions = {}) {
    const o: ChopLoggerOptions = typeof opts === 'string' ? { installDir: opts } : opts;
    this.installDir = o.installDir ?? resolveChopInstallDir();
    this.chopBinPath = path.join(this.installDir, 'chop');
    this.timeoutMs = o.timeoutMs ?? CHOP_DEFAULT_TIMEOUT_MS;
  }

  /** Absolute path of the isolated `chop` binary. */
  get binaryPath(): string {
    return this.chopBinPath;
  }

  /** Buffered lines waiting for the next flush. */
  get pending(): number {
    return this.buffer.length;
  }

  /** Buffer a line. Nothing is printed until `flush()`. */
  log(line: string): void {
    this.buffer.push(line);
  }

  /** Drop buffered lines without printing them. */
  clear(): void {
    this.buffer = [];
  }

  /** Isolated binary first, then whatever `chop` is on PATH. `null` when neither exists. */
  resolveBinary(): string | null {
    if (existsSync(this.chopBinPath)) return this.chopBinPath;
    if (this.pathChop === undefined) this.pathChop = findChopOnPath();
    return this.pathChop;
  }

  /**
   * Make sure a `chop` binary is usable: no-op when the isolated install or a
   * PATH copy already exists, otherwise install it into the isolated dir.
   * Never throws — returns whether compression will be attempted by `flush()`.
   */
  async ensureInstalled(): Promise<boolean> {
    if (this.installAttempted) return this.installOk;
    this.installAttempted = true;
    if (this.resolveBinary() !== null) {
      this.installOk = true;
      return true;
    }
    this.installOk = await this.installChop();
    return this.installOk;
  }

  /** Compress the buffer through `chop cat` and print it. Falls back to raw output on any failure. */
  async flush(): Promise<void> {
    if (this.buffer.length === 0) return;
    const rawOutput = this.buffer.join('\n');
    this.buffer = [];

    const bin = this.resolveBinary();
    if (!bin) {
      process.stdout.write(withTrailingNewline(rawOutput));
      return;
    }

    const tempFile = path.join(os.tmpdir(), `agent-tier-chop-${randomUUID()}.log`);
    let compressed: string | null = null;
    try {
      writeFileSync(tempFile, rawOutput, { mode: 0o600 });
      compressed = await this.runChop(bin, tempFile);
    } catch (err) {
      warnChop(`compression failed: ${(err as Error).message}`);
    } finally {
      try {
        unlinkSync(tempFile);
      } catch {
        // temp file already gone
      }
    }

    if (compressed === null) {
      warnChop('compression failed, falling back to raw output');
      process.stdout.write(withTrailingNewline(rawOutput));
      return;
    }
    process.stdout.write(withTrailingNewline(compressed));
  }

  private async installChop(): Promise<boolean> {
    try {
      mkdirSync(this.installDir, { recursive: true, mode: 0o755 });
    } catch (err) {
      warnChop(`cannot create ${this.installDir}: ${(err as Error).message}`);
      return false;
    }

    const command = `curl -fsSL ${CHOP_INSTALL_SCRIPT_URL} | CHOP_INSTALL_DIR="${this.installDir}" sh`;
    return new Promise<boolean>((resolve) => {
      const child = spawn('sh', ['-c', command], { stdio: ['ignore', 'ignore', 'pipe'] });
      let stderr = '';
      child.stderr?.on('data', (d) => {
        stderr += d.toString();
      });
      const timer = setTimeout(() => {
        try {
          child.kill('SIGKILL');
        } catch {
          // already dead
        }
      }, this.timeoutMs);

      child.on('error', (err) => {
        clearTimeout(timer);
        warnChop(`install spawn failed: ${err.message}`);
        resolve(false);
      });
      child.on('close', (code) => {
        clearTimeout(timer);
        const installed = code === 0 && existsSync(this.chopBinPath);
        if (!installed) warnChop(`install failed (exit ${code})${firstLine(stderr)}`);
        resolve(installed);
      });
    });
  }

  private runChop(bin: string, tempFile: string): Promise<string | null> {
    return new Promise<string | null>((resolve) => {
      const child = spawn(bin, ['cat', tempFile], { stdio: ['ignore', 'pipe', 'pipe'] });
      let stdout = '';
      let stderr = '';
      child.stdout?.on('data', (d) => {
        stdout += d.toString();
      });
      child.stderr?.on('data', (d) => {
        stderr += d.toString();
      });
      const timer = setTimeout(() => {
        try {
          child.kill('SIGKILL');
        } catch {
          // already dead
        }
      }, this.timeoutMs);

      const done = (result: string | null) => {
        clearTimeout(timer);
        resolve(result);
      };

      child.on('error', (err) => {
        warnChop(`spawn failed: ${err.message}`);
        done(null);
      });
      child.on('close', (code) => {
        if (code === 0 && stdout.trim().length > 0) {
          done(stdout);
          return;
        }
        const reason = code === 0 ? 'cat produced no output' : `cat exited ${code}`;
        warnChop(`${reason}${firstLine(stderr)}`);
        done(null);
      });
    });
  }
}
