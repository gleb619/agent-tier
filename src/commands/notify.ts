import { Command } from 'commander';
import { appendFileSync, mkdirSync } from 'fs';
import path from 'path';
import type { NotifyEvent } from '../notify/types';

export function registerNotifyCommand(program: Command): void {
  program
    .command('notify <runId> <message...>')
    .description('Report a progress message for a run (POSTs to SSE hub or writes event file)')
    .action(async (runId: string, messageParts: string[]) => {
      const text = messageParts.join(' ');
      const event: Omit<NotifyEvent, 'seq'> = {
        runId,
        agent: 'user',
        ts: new Date().toISOString(),
        type: 'message',
        text,
      };

      const sseUrl = process.env.AT_SSE_URL;
      if (sseUrl) {
        const url = `${sseUrl}/emit/${encodeURIComponent(runId)}`;
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ type: 'message', text }),
        });
        if (!res.ok) {
          console.error(`[at] notify failed: ${res.status} ${await res.text()}`);
          process.exit(1);
        }
        return;
      }

      const eventFile = process.env.AT_EVENT_FILE;
      if (!eventFile) {
        console.error('[at] notify: AT_SSE_URL or AT_EVENT_FILE must be set');
        process.exit(1);
      }
      mkdirSync(path.dirname(eventFile), { recursive: true });
      appendFileSync(eventFile, JSON.stringify({ ...event, seq: 0 }) + '\n');
    });
}
