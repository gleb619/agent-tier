import { resolveStateDir } from './state-dir';

export interface RunOptions {
  agent: string;
  tier: 1 | 2 | 3 | 4;
  prompt: string;
  model?: string;
  cwd?: string;
  env?: Record<string, string>;
  stream: boolean;
  stateDir: string;
  retries: number;
  logDir: string;
  noChop: boolean;
  timeout: number;
}

interface ArgvOptions {
  agent?: string;
  tier?: string | number;
  prompt?: string;
  model?: string;
  cwd?: string;
  env?: Record<string, string>;
  stream?: boolean;
  stateDir?: string;
  retries?: string | number;
  logDir?: string;
  noChop?: boolean;
  timeout?: string | number;
}

export interface ParsedJson {
  agent: string;
  prompt: string;
  model?: string;
  cwd?: string;
  env?: Record<string, string>;
}

export function resolveFromArgs(argv: ArgvOptions): RunOptions {
  const prompt = argv.prompt?.trim() ?? '';
  if (!prompt) throw new Error('prompt is required and cannot be empty');

  const tierNum = Number(argv.tier ?? 2);
  if (![1, 2, 3, 4].includes(tierNum)) throw new Error(`tier must be 1, 2, 3, or 4 (got ${argv.tier})`);

  const timeoutMs = Number(argv.timeout ?? 3600000);
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new Error('timeout must be a positive number (ms)');

  const retriesNum = Number(argv.retries ?? 0);
  if (!Number.isFinite(retriesNum) || retriesNum < 0 || !Number.isInteger(retriesNum)) throw new Error('retries must be a non-negative integer');

  return {
    agent: argv.agent?.trim() || 'auto',
    tier: tierNum as 1 | 2 | 3 | 4,
    prompt,
    model: argv.model,
    cwd: argv.cwd,
    env: argv.env,
    stream: argv.stream ?? false,
    stateDir: resolveStateDir(argv.stateDir),
    retries: retriesNum,
    logDir: argv.logDir ?? '/tmp/at-logs',
    noChop: argv.noChop ?? false,
    timeout: timeoutMs,
  };
}

export function parseJsonInput(raw: string): ParsedJson {
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('Invalid JSON input');
  }

  const prompt = (parsed.prompt as string | undefined)?.trim() ?? '';
  if (!prompt) throw new Error('JSON input: prompt is required');

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

  return {
    agent: (parsed.agent as string | undefined) ?? 'auto',
    prompt,
    model: parsed.model as string | undefined,
    cwd: parsed.cwd as string | undefined,
    env,
  };
}
