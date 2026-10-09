import { readFileSync, statSync, existsSync } from 'fs';
import type { NotifyEvent, NotifyAdapter } from './types';

export interface Tailer {
  stop(): void;
}

export function tailLogFile(
  logFile: string,
  runId: string,
  agent: string,
  publish: (event: NotifyEvent) => void,
  adapter: NotifyAdapter,
  pollMs = 200,
): Tailer {
  let position = 0;
  let running = true;
  let flushPending = false;
  let timer: ReturnType<typeof setInterval> | undefined;

  function readChunk(): void {
    if (!existsSync(logFile)) return;
    try {
      const stats = statSync(logFile);
      if (stats.size <= position) return;
      const full = readFileSync(logFile, 'utf8');
      const chunk = full.slice(position);
      position = stats.size;
      if (!chunk) return;
      const lines = chunk.split('\n');
      // If chunk didn't end with newline, last line is incomplete; keep for next read.
      const complete = chunk.endsWith('\n') ? lines : lines.slice(0, -1);
      for (const line of complete) {
        if (!line.trim()) continue;
        const parsed = adapter.parseLine ? adapter.parseLine(line) : [];
        for (const partial of parsed) {
          publish({
            ...partial,
            runId,
            agent,
            ts: new Date().toISOString(),
            seq: 0,
          } as NotifyEvent);
        }
      }
    } catch {
      // ignore transient read errors
    }
  }

  function flushBuffer(): void {
    if (!adapter.flush) return;
    for (const partial of adapter.flush()) {
      publish({
        ...partial,
        runId,
        agent,
        ts: new Date().toISOString(),
        seq: 0,
      } as NotifyEvent);
    }
  }

  function tick(): void {
    if (!running && !flushPending) return;
    readChunk();
    if (!running && flushPending) {
      flushBuffer();
      flushPending = false;
      if (timer) clearInterval(timer);
    }
  }

  timer = setInterval(tick, pollMs);

  return {
    stop() {
      if (!running) return;
      running = false;
      flushPending = true;
      tick();
    },
  };
}
