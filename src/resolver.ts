export interface RunOptions {
  agent: string;
  tier: 1 | 2 | 3;
  prompt: string;
  model?: string;
  cwd?: string;
  env?: Record<string, string>;
  stream: boolean;
  globalState: boolean;
  retries: number;
  logDir: string;
}

interface ArgvOptions {
  agent?: string;
  tier?: string | number;
  prompt?: string;
  model?: string;
  cwd?: string;
  env?: Record<string, string>;
  stream?: boolean;
  globalState?: boolean;
  retries?: string | number;
  logDir?: string;
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
  if (![1, 2, 3].includes(tierNum)) throw new Error(`tier must be 1, 2, or 3 (got ${argv.tier})`);

  return {
    agent: argv.agent ?? 'auto',
    tier: tierNum as 1 | 2 | 3,
    prompt,
    model: argv.model,
    cwd: argv.cwd,
    env: argv.env,
    stream: argv.stream ?? false,
    globalState: argv.globalState ?? false,
    retries: Number(argv.retries ?? 2),
    logDir: argv.logDir ?? '/tmp/at-logs',
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
    env: parsed.env as Record<string, string> | undefined,
  };
}
