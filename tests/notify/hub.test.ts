import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import http from 'http';
import { startHub } from '../../src/notify/hub';

describe('notify hub', () => {
  let stateDir: string;
  let hub: Awaited<ReturnType<typeof startHub>>;

  beforeEach(() => {
    stateDir = mkdtempSync(path.join(tmpdir(), 'at-hub-'));
  });

  afterEach(async () => {
    await hub?.close();
    rmSync(stateDir, { recursive: true, force: true });
  });

  function collect(urlPath: string, lastEventId?: string): Promise<{ lines: string[]; events: unknown[] }> {
    return new Promise((resolve, reject) => {
      const headers: Record<string, string> = { Accept: 'text/event-stream' };
      if (lastEventId) headers['Last-Event-ID'] = lastEventId;
      const req = http.get(`http://127.0.0.1:${hub.port}${urlPath}`, { headers }, (res) => {
        const lines: string[] = [];
        let buffer = '';
        res.on('data', (chunk: Buffer) => {
          buffer += chunk.toString();
          const parts = buffer.split('\n\n');
          buffer = parts.pop() ?? '';
          for (const part of parts) {
            if (!part.trim()) continue;
            lines.push(part);
          }
        });
        setTimeout(() => {
          const events = lines
            .map((block) => {
              const dataLine = block.split('\n').find((l) => l.startsWith('data:'));
              return dataLine ? JSON.parse(dataLine.slice(5)) : null;
            })
            .filter(Boolean);
          res.destroy();
          resolve({ lines, events });
        }, 400);
      });
      req.on('error', reject);
    });
  }

  it('replays stored events and broadcasts live', async () => {
    hub = await startHub({ stateDir, port: 0 });
    hub.publish({ runId: 'r1', agent: 'a', ts: new Date().toISOString(), seq: 0, type: 'start' });
    hub.publish({ runId: 'r1', agent: 'a', ts: new Date().toISOString(), seq: 0, type: 'message', text: 'one' });

    const { events } = await collect('/events/r1');
    expect(events).toHaveLength(2);
    expect((events[0] as { type: string }).type).toBe('start');
    expect((events[1] as { text: string }).text).toBe('one');
  });

  it('POST /emit stores and broadcasts', async () => {
    hub = await startHub({ stateDir, port: 0 });
    const res = await fetch(`http://127.0.0.1:${hub.port}/emit/r2`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'progress', text: 'halfway' }),
    });
    expect(res.status).toBe(202);

    const { events } = await collect('/events/r2');
    expect(events).toHaveLength(1);
    expect((events[0] as { type: string; text: string }).text).toBe('halfway');
  });

  it('supports Last-Event-ID resume', async () => {
    hub = await startHub({ stateDir, port: 0 });
    hub.publish({ runId: 'r3', agent: 'a', ts: new Date().toISOString(), seq: 0, type: 'message', text: 'a' });
    hub.publish({ runId: 'r3', agent: 'a', ts: new Date().toISOString(), seq: 0, type: 'message', text: 'b' });
    hub.publish({ runId: 'r3', agent: 'a', ts: new Date().toISOString(), seq: 0, type: 'message', text: 'c' });

    const { events } = await collect('/events/r3', '1');
    expect(events.map((e: unknown) => (e as { text: string }).text)).toEqual(['b', 'c']);
  });

  it('close() destroys open SSE connections and lets server.close resolve', async () => {
    hub = await startHub({ stateDir, port: 0 });

    // Hold a long-lived SSE connection (won't naturally end in this test).
    const req = http.get(`http://127.0.0.1:${hub.port}/events/close-test`, {
      headers: { Accept: 'text/event-stream' },
    });
    const clientRes = await new Promise<http.IncomingMessage>((resolve, reject) => {
      req.on('response', resolve);
      req.on('error', reject);
    });
    const clientSocket = clientRes.socket;
    expect(clientSocket).toBeDefined();
    expect(clientSocket?.destroyed).toBe(false);

    // Allow the hub a moment to register the client (req has not yet closed).
    await new Promise((r) => setTimeout(r, 50));

    const closeStart = Date.now();
    await hub.close();
    const closeMs = Date.now() - closeStart;

    // The hub must close promptly even with an open SSE connection.
    expect(closeMs).toBeLessThan(1500);
    // The client socket was destroyed by hub.close().
    expect(clientSocket?.destroyed).toBe(true);
    // Tidy: the test left a dangling request — node will GC the response.
    req.destroy();

    // After close, subsequent close() is a no-op.
    await expect(hub.close()).resolves.toBeUndefined();
    hub = undefined;
  });

  it('falls back to a random port when the requested port is busy', async () => {
    const blocker = http.createServer();
    await new Promise<void>((resolve) => blocker.listen(0, '127.0.0.1', resolve));
    const blockerPort = (blocker.address() as { port: number }).port;

    const warnings: string[] = [];
    hub = await startHub({
      stateDir,
      port: blockerPort,
      warn: (m) => warnings.push(m),
    });

    // Falls back to a different port (the OS-assigned one).
    expect(hub.port).not.toBe(blockerPort);
    expect(hub.port).toBeGreaterThan(0);
    expect(hub.requestedPort).toBe(blockerPort);
    expect(warnings.some((w) => w.includes('busy') && w.includes(String(blockerPort)))).toBe(true);

    await new Promise<void>((resolve) => blocker.close(() => resolve()));
    hub = undefined;
  });

  it('does not warn when the requested port is 0 (random from the start)', async () => {
    const warnings: string[] = [];
    hub = await startHub({
      stateDir,
      port: 0,
      warn: (m) => warnings.push(m),
    });
    expect(hub.port).toBeGreaterThan(0);
    expect(warnings).toEqual([]);
    hub = undefined;
  });
});
