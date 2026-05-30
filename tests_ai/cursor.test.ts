import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawn } from 'child_process';
import { createSandbox, cleanupSandbox, agentBinExists, getCliPath, DEFAULT_TIMEOUT, Sandbox } from './setup';

describe('cursor agent', () => {
  let sandbox: Sandbox;

  beforeEach(() => { sandbox = createSandbox(); });
  afterEach(() => { cleanupSandbox(sandbox); });

  it('should create test_result.txt with hello world', async () => {
    if (!agentBinExists('cursor')) {
      console.log('SKIP: cursor-agent binary not found');
      return;
    }

    const cliPath = getCliPath();
    const prompt = "Create a file called test_result.txt containing the text 'hello world' and nothing else.";

    const exitCode = await new Promise<number>((resolve) => {
      const child = spawn('node', [cliPath, '-s', '-a', 'cursor', '-p', prompt, '--timeout', String(DEFAULT_TIMEOUT)], {
        cwd: sandbox.dir,
        stdio: 'inherit',
      });
      child.on('close', (code) => resolve(code ?? 1));
    });

    expect(exitCode).toBe(0);
  }, DEFAULT_TIMEOUT + 10000);
});
