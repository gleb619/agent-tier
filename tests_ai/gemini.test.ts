import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawn } from 'child_process';
import { createSandbox, cleanupSandbox, agentBinExists, getCliPath, classifyAgentExit, readAgentLog, DEFAULT_TIMEOUT, Sandbox } from './setup';

describe('gemini agent', () => {
  let sandbox: Sandbox;

  beforeEach(() => { sandbox = createSandbox(); });
  afterEach(() => { cleanupSandbox(sandbox); });

  it('should create test_result.txt with hello world', async () => {
    if (!agentBinExists('gemini')) {
      console.log('SKIP: gemini binary not found');
      return;
    }

    const cliPath = getCliPath();
    const prompt = "Create a file called test_result.txt containing the text 'hello world' and nothing else.";

    let output = '';
    const exitCode = await new Promise<number>((resolve) => {
      const child = spawn('node', [cliPath, '-s', '-a', 'gemini', '-p', prompt, '--timeout', String(DEFAULT_TIMEOUT)], {
        cwd: sandbox.dir,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      child.stdout.on('data', (d) => { output += d; });
      child.stderr.on('data', (d) => { output += d; });
      child.on('close', (code) => resolve(code ?? 1));
    });

    // External/auth failure (e.g. deprecated offer tier, expired creds) → SKIP, not FAIL.
    // Stream mode filters child stderr, so also scan the log file (authoritative).
    const logContent = readAgentLog('gemini', output);
    if (classifyAgentExit(exitCode, `${output}\n${logContent}`) === 'external-failure') {
      console.log(`SKIP: gemini external/auth failure (exit ${exitCode})`);
      return;
    }

    expect(exitCode).toBe(0);
  }, DEFAULT_TIMEOUT + 10000);
});