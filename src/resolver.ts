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
  orchestrate: boolean;
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
  orchestrate?: boolean;
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

  return {
    agent: argv.agent ?? 'auto',
    tier: tierNum as 1 | 2 | 3 | 4,
    prompt,
    model: argv.model,
    cwd: argv.cwd,
    env: argv.env,
    stream: argv.stream ?? false,
    stateDir: resolveStateDir(argv.stateDir),
    retries: Number(argv.retries ?? 0),
    logDir: argv.logDir ?? '/tmp/at-logs',
    orchestrate: argv.orchestrate ?? false,
    noChop: argv.noChop ?? false,
    timeout: Number(argv.timeout ?? 3600000),
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

  return {
    agent: (parsed.agent as string | undefined) ?? 'auto',
    prompt,
    model: parsed.model as string | undefined,
    cwd: parsed.cwd as string | undefined,
    env: parsed.env as Record<string, string | undefined> as Record<string, string> | undefined,
  };
}
