import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, chmodSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import http from 'http';
import { defaultSpawner, closeProcessHub, getProcessHub } from '../../src/runner';
import { loadRuns } from '../../src/run-store';
import { readEvents } from '../../src/notify/store';
import type { AgentDef } from '../../src/agents/registry';
import type { RunOptions } from '../../src/resolver';

describe('runner sse', () => {
  let tmp: string;
  let stateDir: string;
  let logDir: string;
  let script: string;

  beforeEach(() => {
    tmp = mkdtempSync(path.join(tmpdir(), 'at-runner-sse-'));
    stateDir = path.join(tmp, 'state');
    logDir = path.join(tmp, 'logs');
    script = path.join(tmp, 'agent.js');
    writeFileSync(script, `#!/usr/bin/env node\nconsole.log('agent output');\nprocess.exit(0);\n`);
    chmodSync(script, 0o755);
  });

  afterEach(async () => {
    await closeProcessHub();
    rmSync(tmp, { recursive: true, force: true });
  });

  function makeAgent(): AgentDef {
    return {
      name: 'mock-sse',
      tier: 4,
      bin: () => script,
      buildArgs: () => [],
    };
  }

  function options(): RunOptions {
    return {
      agent: 'mock-sse',
      tier: 4,
      prompt: 'test prompt',
      stream: false,
      stateDir,
      retries: 0,
      logDir,
      noChop: true,
      timeout: 10000,
      sse: true,
      ssePort: 0,
    };
  }

  it('publishes start, message, done events', async () => {
    const agent = makeAgent();
    const opts = options();
    const exitCode = await defaultSpawner(agent, opts);
    expect(exitCode).toBe(0);

    const runs = loadRuns(stateDir);
    const run = runs.find((r: { agent: string }) => r.agent === 'mock-sse');
    expect(run).toBeDefined();

    // Verify hub is still alive (it is returned by singleton).
    const hub2 = await getProcessHub(opts);
    expect(hub2.port).toBeGreaterThan(0);
    const fileEvents = readEvents(stateDir, run.runId);
    const types = fileEvents.map((e: { type: string }) => e.type);
    expect(types).toContain('start');
    expect(types).toContain('message');
    expect(types).toContain('done');
    const msgs = fileEvents.filter((e: { type: string }) => e.type === 'message');
    expect(msgs.some((e: { text?: string }) => e.text?.includes('agent output'))).toBe(true);
  });

  it('closes the SSE hub after the run so the process can exit (detached)', async () => {
    const agent = makeAgent();
    const opts = options();
    const hubBefore = await getProcessHub(opts);
    expect(hubBefore.port).toBeGreaterThan(0);

    const exitCode = await defaultSpawner(agent, opts);
    expect(exitCode).toBe(0);

    // After the run completes, hub.close() must have been called — the underlying
    // server must no longer accept connections. We probe by trying a fresh
    // connection; in Node, connect-to-closed-server fires ECONNREFUSED immediately.
    const probe = await new Promise<{ ok: boolean; err?: string }>((resolve) => {
      const req = http.get(`http://127.0.0.1:${hubBefore.port}/events/x`, (res) => {
        res.resume();
        res.on('end', () => resolve({ ok: false, err: 'unexpected 200' }));
      });
      req.on('error', (err) => resolve({ ok: false, err: err.message }));
      req.setTimeout(500, () => {
        req.destroy();
        resolve({ ok: false, err: 'timeout' });
      });
    });
    expect(probe.ok).toBe(false);
  });

  it('closes the SSE hub after the run in stream mode', async () => {
    const agent = makeAgent();
    const opts = { ...options(), stream: true };
    const hubBefore = await getProcessHub(opts);
    expect(hubBefore.port).toBeGreaterThan(0);

    const exitCode = await defaultSpawner(agent, opts);
    expect(exitCode).toBe(0);

    const probe = await new Promise<{ ok: boolean; err?: string }>((resolve) => {
      const req = http.get(`http://127.0.0.1:${hubBefore.port}/events/x`, (res) => {
        res.resume();
        res.on('end', () => resolve({ ok: false, err: 'unexpected 200' }));
      });
      req.on('error', (err) => resolve({ ok: false, err: err.message }));
      req.setTimeout(500, () => {
        req.destroy();
        resolve({ ok: false, err: 'timeout' });
      });
    });
    expect(probe.ok).toBe(false);
  });
});
