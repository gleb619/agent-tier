import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawn } from 'child_process';
import { execSync } from 'child_process';
import {
  createSandbox,
  cleanupSandbox,
  agentBinExists,
  getCliPath,
  Sandbox,
} from './setup';

function chopAvailable(): boolean {
  try {
    execSync('chop --version', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

describe('chop stream integration', () => {
  let sandbox: Sandbox;

  beforeEach(() => {
    sandbox = createSandbox();
  });

  afterEach(() => {
    cleanupSandbox(sandbox);
  });

  it('should not crash with permission denied when chop is available', async () => {
    if (!chopAvailable()) {
      console.log('SKIP: chop binary not found');
      return;
    }
    if (!agentBinExists('mock')) {
      console.log('SKIP: mock-agent binary not found');
      return;
    }

    const cliPath = getCliPath();
    const prompt = 'chop integration test prompt';

    let stdout = '';
    let stderr = '';

    const exitCode = await new Promise<number>((resolve) => {
      const child = spawn(
        'node',
        [cliPath, '-s', '-a', 'mock', '-p', prompt, '--timeout', '10000'],
        {
          cwd: sandbox.dir,
          stdio: ['ignore', 'pipe', 'pipe'],
        },
      );

      child.stdout?.on('data', (d) => {
        stdout += d.toString();
      });
      child.stderr?.on('data', (d) => {
        stderr += d.toString();
      });
      child.on('close', (code) => resolve(code ?? 1));
    });

    expect(exitCode).toBe(0);
    expect(stderr).not.toContain('permission denied');
    expect(stderr).not.toContain('fork/exec');
  }, 15000);

  it('should stream agent output via plain tail when --no-chop is used', async () => {
    if (!agentBinExists('mock')) {
      console.log('SKIP: mock-agent binary not found');
      return;
    }

    const cliPath = getCliPath();
    const prompt = 'plain tail integration test prompt';

    let stdout = '';
    let stderr = '';

    const exitCode = await new Promise<number>((resolve) => {
      const child = spawn(
        'node',
        [cliPath, '-s', '--no-chop', '-a', 'mock', '-p', prompt, '--timeout', '10000'],
        {
          cwd: sandbox.dir,
          stdio: ['ignore', 'pipe', 'pipe'],
        },
      );

      child.stdout?.on('data', (d) => {
        stdout += d.toString();
      });
      child.stderr?.on('data', (d) => {
        stderr += d.toString();
      });
      child.on('close', (code) => resolve(code ?? 1));
    });

    expect(exitCode).toBe(0);
    expect(stdout).toContain('[mock] received prompt:');
    expect(stdout).toContain(prompt);
    expect(stderr).not.toContain('permission denied');
  }, 15000);
});
