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
