import { resolveStateDir } from './state-dir';
import { readPromptFile } from './prompt-file';

export interface RunOptions {
  agent: string;
  /**
   * Scheduling tier. When undefined, `run()` falls back to "line mode" — a
   * single ordered queue (see `getLineAgents` in `src/config.ts`).
   */
  tier?: 1 | 2 | 3 | 4;
  prompt: string;
  model?: string;
  cwd?: string;
  env?: Record<string, string>;
  stream: boolean;
  /**
   * Detached mode only: block until the agent exits instead of returning
   * right after the run box is printed. When false (default) a background
   * supervisor (`src/run-watch.ts`) finalises the run record and callback.
   * Timeout, retry, agent-health tracking and callbacks with a real exit code
   * only exist when this is true (or when `stream` is on).
   */
  wait: boolean;
  stateDir: string;
  retries: number;
  logDir: string;
  noChop: boolean;
  timeout: number;
  callback?: string;
  sse: boolean;
  ssePort: number;
  /** Set by `run()` after namer runs; consumed by `defaultSpawner`. */
  runName?: string;
  /**
   * Optional shell command executed AFTER the agent exits but BEFORE
   * --callback. In blocking paths (--stream / --wait) it runs in the agent's
   * cwd (`options.cwd ?? process.cwd()`); the detached supervisor runs it in
   * `process.cwd()` (the agent's cwd is also forwarded via AT_CWD when set).
   * Non-zero exit fails the run: status='failed', run log line appended,
   * AgentError thrown so --stream / --wait retry-with-next-agent applies,
   * and the --callback fires with AT_STATUS='failed'.
   */
  verify?: string;
  normka?: boolean;
  sandbox?: boolean;
  globalPrompt?: string;
}

interface ArgvOptions {
  agent?: string;
  tier?: string | number;
  prompt?: string;
  model?: string;
  cwd?: string;
  env?: Record<string, string>;
  stream?: boolean;
  wait?: boolean;
  stateDir?: string;
  retries?: string | number;
  logDir?: string;
  noChop?: boolean;
  timeout?: string | number;
  callback?: string;
  sse?: boolean | string;
    ssePort?: string | number;
    verify?: string;
    normka?: boolean;
    sandbox?: boolean;
    globalPrompt?: string;
}

export interface ParsedJson {
  agent: string;
  tier?: 1 | 2 | 3 | 4;
  prompt: string;
  model?: string;
  cwd?: string;
  env?: Record<string, string>;
  callback?: string;
  sse?: boolean;
  ssePort?: number;
  verify?: string;
  /**
   * Resolved prompt content from a `promptFile` field. Holds the file's text
   * (or the inner `prompt` field for .json) AFTER read. Allows `prompt` to
   * be derived purely from a file path passed via JSON.
   */
  promptFileContent?: string;
  normka?: boolean;
  sandbox?: boolean;
  globalPrompt?: string;
}

function parseTier(raw: unknown, source: 'argv' | 'json'): 1 | 2 | 3 | 4 {
  const n = Number(raw);
  if (!Number.isInteger(n) || ![1, 2, 3, 4].includes(n)) {
    throw new Error(`tier must be 1, 2, 3, or 4 (got ${JSON.stringify(raw)}) [${source}]`);
  }
  return n as 1 | 2 | 3 | 4;
}

export function resolveFromArgs(argv: ArgvOptions): RunOptions {
  const prompt = argv.prompt?.trim() ?? '';
  if (!prompt) throw new Error('prompt is required and cannot be empty');

  // No implicit default — absent tier means line mode.
  const tier = argv.tier !== undefined ? parseTier(argv.tier, 'argv') : undefined;

  const timeoutMs = Number(argv.timeout ?? 3600000);
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new Error('timeout must be a positive number (ms)');

  const retriesNum = Number(argv.retries ?? 0);
  if (!Number.isFinite(retriesNum) || retriesNum < 0 || !Number.isInteger(retriesNum)) throw new Error('retries must be a non-negative integer');

  // `--sse` (commander -> true) and `--sse <port>` (commander -> '<port>') both enable SSE.
  // `--sse true` / `--sse TRUE` also accepted for parity. Reject other strings as invalid ports.
  let sse = false;
  if (argv.sse === true) {
    sse = true;
  } else if (typeof argv.sse === 'string') {
    const raw = argv.sse.trim();
    if (raw === '' || raw.toLowerCase() === 'true') {
      sse = true;
    } else {
      const asPort = Number(raw);
      if (Number.isFinite(asPort) && asPort >= 0 && Number.isInteger(asPort)) {
        sse = true; // numeric string enables SSE and sets port below
      } else {
        throw new Error(`--sse value must be empty, "true", or a non-negative integer port (got "${argv.sse}")`);
      }
    }
  }
  let ssePort = 7777;
  if (argv.ssePort !== undefined) {
    ssePort = Number(argv.ssePort);
    if (!Number.isFinite(ssePort) || ssePort < 0 || !Number.isInteger(ssePort)) throw new Error('ssePort must be a non-negative integer');
  } else if (typeof argv.sse === 'string' && argv.sse.trim() && argv.sse.trim().toLowerCase() !== 'true') {
    ssePort = Number(argv.sse.trim());
    if (!Number.isFinite(ssePort) || ssePort < 0 || !Number.isInteger(ssePort)) throw new Error('--sse port must be a non-negative integer');
  }

  return {
    agent: argv.agent?.trim() || 'auto',
    tier,
    prompt,
    model: argv.model,
    cwd: argv.cwd,
    env: argv.env,
    stream: argv.stream ?? false,
    wait: argv.wait ?? false,
    stateDir: resolveStateDir(argv.stateDir),
    retries: retriesNum,
    logDir: argv.logDir ?? '/tmp/at-logs',
    noChop: argv.noChop ?? false,
    timeout: timeoutMs,
    callback: argv.callback?.trim() || undefined,
    sse,
    ssePort,
    verify: argv.verify?.trim() || undefined,
    normka: argv.normka === true,
    sandbox: argv.sandbox === true ? true : undefined,
    globalPrompt: argv.globalPrompt?.trim() || undefined,
  };
}

export function mergeJsonDefaults(stdin: Record<string, unknown>, defaults: Record<string, unknown> | undefined): Record<string, unknown> {
  if (!defaults) return stdin;
  const out: Record<string, unknown> = { ...defaults };
  for (const [k, v] of Object.entries(stdin)) {
    if (k === 'env' && v && typeof v === 'object' && !Array.isArray(v) && typeof defaults.env === 'object' && !Array.isArray(defaults.env)) {
      out.env = { ...(defaults.env as Record<string, unknown>), ...(v as Record<string, unknown>) };
    } else {
      out[k] = v;
    }
  }
  return out;
}

export function parseJsonInput(raw: string): ParsedJson {
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('Invalid JSON input');
  }

  const inlinePrompt = (parsed.prompt as string | undefined)?.trim() ?? '';

  // Optional `promptFile` field. If present and `prompt` isn't, read the file
  // and use its content as the prompt. If both are present, the inline `prompt`
  // wins (user wrote it literally). Validate type up-front so we can throw
  // before hitting the filesystem.
  let promptFileContent: string | undefined;
  if (parsed.promptFile !== undefined) {
    if (typeof parsed.promptFile !== 'string' || !parsed.promptFile.trim()) {
      throw new Error('JSON input: promptFile must be a non-empty string');
    }
    if (!inlinePrompt) {
      promptFileContent = readPromptFile(parsed.promptFile);
    }
  }

  const prompt = inlinePrompt || promptFileContent || '';
  if (!prompt) throw new Error('JSON input: prompt is required (or supply promptFile)');

  const rawEnv = parsed.env;
  let env: Record<string, string> | undefined;
  if (rawEnv !== undefined) {
    if (typeof rawEnv !== 'object' || rawEnv === null || Array.isArray(rawEnv)) {
      throw new Error('JSON input: env must be a plain object');
    }
    for (const [k, v] of Object.entries(rawEnv as Record<string, unknown>)) {
      if (typeof v !== 'string') {
        throw new Error('JSON input: env values must be strings (got ' + typeof v + ' for key "' + k + '")');
      }
    }
    env = rawEnv as Record<string, string>;
  }

  const ssePortRaw = parsed.ssePort;
  let ssePort: number | undefined;
  if (ssePortRaw !== undefined) {
    ssePort = Number(ssePortRaw);
    if (!Number.isFinite(ssePort) || ssePort < 0 || !Number.isInteger(ssePort)) {
      throw new Error('JSON input: ssePort must be a non-negative integer');
    }
  }

  const tierRaw = parsed.tier;
  const tier = tierRaw !== undefined ? parseTier(tierRaw, 'json') : undefined;

  return {
    agent: (parsed.agent as string | undefined) ?? 'auto',
    tier,
    prompt,
    model: parsed.model as string | undefined,
    cwd: parsed.cwd as string | undefined,
    env,
    callback: (parsed.callback as string | undefined)?.trim() || undefined,
    sse: parsed.sse === true,
    ssePort,
    verify: (parsed.verify as string | undefined)?.trim() || undefined,
    promptFileContent,
    normka: parsed.normka === true,
    sandbox: parsed.sandbox === true ? true : undefined,
    globalPrompt: (parsed.globalPrompt as string | undefined)?.trim() || undefined,
  };
}
