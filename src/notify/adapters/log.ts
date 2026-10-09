import type { NotifyAdapter, NotifyEvent } from '../types';
import { appendDiscussInstruction } from '../prompt';

const ANSI_RE = /\x1b\[[0-9;]*m/g;

export function makeLogAdapter(): NotifyAdapter {
  let buffer: string[] = [];
  let lastFlush = 0;
  return {
    name: 'log',
    promptSuffix(ctx) {
      // Preserve the legacy `at notify` instruction so log-output agents still
      // discover the milestone channel, then append the shared discuss hint.
      const existing = `\n\nReport progress by running: at notify ${ctx.runId} "<short message>" at major milestones.`;
      return appendDiscussInstruction(existing);
    },
    parseLine(line) {
      const clean = line.replace(ANSI_RE, '').trim();
      if (!clean) return [];
      buffer.push(clean);
      const now = Date.now();
      if (now - lastFlush < 250) return [];
      lastFlush = now;
      const text = buffer.join('\n');
      buffer = [];
      return [{ type: 'message' as const, text }];
    },
    flush() {
      if (buffer.length === 0) return [];
      const text = buffer.join('\n');
      buffer = [];
      return [{ type: 'message' as const, text }];
    },
  };
}

export const logAdapter = makeLogAdapter();