import { existsSync, openSync, closeSync, readSync } from 'fs';
import { loadFilterConfig, buildDropPatterns, shouldDrop, FilterConfig } from './chop';

interface ParseArgsResult {
  log: string;
  pid: number;
  config?: string;
}

function parseArgs(): ParseArgsResult {
  const args = process.argv.slice(2);
  let log = '';
  let pid = 0;
  let config: string | undefined;
  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--log':
        log = args[++i];
        break;
      case '--pid':
        pid = parseInt(args[++i], 10);
        break;
      case '--config':
        config = args[++i];
        break;
    }
  }
  if (!log || !pid) {
    console.error('Usage: log-streamer --log <path> --pid <pid> [--config <path>]');
    process.exit(1);
  }
  return { log, pid, config };
}

function main() {
  const { log, pid, config } = parseArgs();
  const filterConfig = loadFilterConfig(config);
  const dropPatterns = buildDropPatterns(filterConfig);
  const groupRepeated = filterConfig.groupRepeated ?? true;

  const fd = openSync(log, 'r');
  let position = 0;

  let lastLine: string | null = null;
  let repeatCount = 0;
  let lastDataTime = Date.now();
  let running = true;

  function flushLine(line: string) {
    if (shouldDrop(line, dropPatterns)) return;
    if (groupRepeated) {
      if (line === lastLine) {
        repeatCount++;
        return;
      }
      if (lastLine !== null && repeatCount > 1) {
        process.stdout.write(`  … (${repeatCount} times)\n`);
      }
      lastLine = line;
      repeatCount = 1;
    }
    process.stdout.write(line + '\n');
  }

  function flushRepeated() {
    if (groupRepeated && lastLine !== null && repeatCount > 1) {
      process.stdout.write(`  … (${repeatCount} times)\n`);
      lastLine = null;
      repeatCount = 0;
    }
  }

  function readNewData(): boolean {
    let newData = false;
    const bufSize = 64 * 1024;
    const buffer = Buffer.alloc(bufSize);
    while (true) {
      const bytesRead = readSync(fd, buffer, 0, bufSize, position);
      if (bytesRead === 0) break;
      newData = true;
      position += bytesRead;
      const chunk = buffer.toString('utf8', 0, bytesRead);
      const lines = chunk.split('\n');
      // All elements except the last are complete lines (they had a trailing \n)
      for (let i = 0; i < lines.length - 1; i++) {
        flushLine(lines[i]);
      }
      const lastPart = lines[lines.length - 1];
      if (!chunk.endsWith('\n')) {
        // lastPart is an incomplete line — rewind so it gets read again
        // once more data (or the final newline) arrives.
        position -= Buffer.byteLength(lastPart, 'utf8');
      }
    }
    return newData;
  }

  function isPidAlive(p: number): boolean {
    try {
      process.kill(p, 0);
      return true;
    } catch {
      return false;
    }
  }

  const fileInterval = setInterval(() => {
    if (!running) return;
    if (readNewData()) {
      lastDataTime = Date.now();
    }
  }, 100);

  const pidInterval = setInterval(() => {
    if (!running) return;
    const alive = isPidAlive(pid);
    if (!alive) {
      readNewData();
      const sinceLastData = Date.now() - lastDataTime;
      if (sinceLastData > 1000) {
        flushRepeated();
        running = false;
        clearInterval(fileInterval);
        clearInterval(pidInterval);
        closeSync(fd);
        process.exit(0);
      }
    }
  }, 500);

  function handleSignal() {
    flushRepeated();
    running = false;
    clearInterval(fileInterval);
    clearInterval(pidInterval);
    closeSync(fd);
    process.exit(0);
  }

  process.once('SIGTERM', handleSignal);
  process.once('SIGINT', handleSignal);
}

main();
