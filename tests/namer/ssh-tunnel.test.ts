import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'events';

const spawnMock = vi.fn();
let lastSpawned: FakeChild | null = null;

class FakeChild extends EventEmitter {
  pid: number | undefined = 12345;
  killed = false;
  exitCode: number | null = null;
  signalCode: string | null = null;
  stdin: any = null;
  stdout: any = null;
  stderr: any = null;

  kill(sig?: string): boolean {
    this.killed = true;
    if (sig === 'SIGKILL' || sig === 'SIGTERM') {
      this.exitCode = sig === 'SIGKILL' ? 137 : 143;
      this.signalCode = sig;
      queueMicrotask(() => this.emit('exit', this.exitCode, sig ?? null));
    }
    return true;
  }
}

vi.mock('child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('child_process')>();
  return {
    ...actual,
    spawn: (...args: any[]) => {
      spawnMock(...args);
      lastSpawned = new FakeChild();
      return lastSpawned;
    },
  };
});

// Import AFTER mock so the module picks up the mocked spawn
import { openSshTunnel, type SshTunnelHandle } from '../../src/namer/ssh-tunnel';

/** Helper: open a tunnel, return both the handle and the fake child used. */
async function openAndCapture(opts: Parameters<typeof openSshTunnel>[0]): Promise<{ handle: SshTunnelHandle; child: FakeChild }> {
  const handle = await openSshTunnel(opts);
  // After openSshTunnel resolved, lastSpawned holds the FakeChild that was returned.
  // (openSshTunnel is single-spawn per call.)
  if (!lastSpawned) throw new Error('spawn mock did not record a child');
  return { handle, child: lastSpawned };
}

beforeEach(() => {
  spawnMock.mockClear();
  lastSpawned = null;
});

describe('openSshTunnel', () => {
  it('returns a handle with localUrl pointing at 127.0.0.1', async () => {
    const { handle } = await openAndCapture({
      host: 'borispc3.ai',
      user: 'boris',
      remoteHost: '127.0.0.1',
      remotePort: 11434,
    });
    expect(handle.localUrl).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    await handle.close();
  });

  it('constructs ssh -N -L with a real local port', async () => {
    const { handle } = await openAndCapture({
      host: 'borispc3.ai',
      user: 'boris',
      remoteHost: '127.0.0.1',
      remotePort: 11434,
    });

    expect(spawnMock).toHaveBeenCalledTimes(1);
    const [cmd, args] = spawnMock.mock.calls[0]!;
    expect(cmd).toBe('ssh');
    expect(Array.isArray(args)).toBe(true);

    const argsArr = args as string[];
    const lIdx = argsArr.indexOf('-L');
    expect(lIdx).toBeGreaterThan(-1);
    const lVal = argsArr[lIdx + 1];
    expect(lVal).toMatch(/^\d+:127\.0\.0\.1:11434$/);

    const match = lVal!.match(/^(\d+):/);
    expect(handle.localUrl).toBe(`http://127.0.0.1:${match![1]}`);

    await handle.close();
  });

  it('includes -p <port> when ssh port is provided', async () => {
    await openAndCapture({
      host: 'borispc3.ai',
      user: 'boris',
      port: 2222,
      remoteHost: '127.0.0.1',
      remotePort: 11434,
    });

    const [, args] = spawnMock.mock.calls[0]!;
    const argsArr = args as string[];
    const pIdx = argsArr.indexOf('-p');
    expect(pIdx).toBeGreaterThan(-1);
    expect(argsArr[pIdx + 1]).toBe('2222');
  });

  it('omits -p when ssh port is default (22)', async () => {
    await openAndCapture({
      host: 'borispc3.ai',
      user: 'boris',
      remoteHost: '127.0.0.1',
      remotePort: 11434,
    });

    const [, args] = spawnMock.mock.calls[0]!;
    const argsArr = args as string[];
    expect(argsArr).not.toContain('-p');
  });

  it('includes -i <identityFile> when provided', async () => {
    await openAndCapture({
      host: 'borispc3.ai',
      user: 'boris',
      identityFile: '~/.ssh/id_rsa',
      remoteHost: '127.0.0.1',
      remotePort: 11434,
    });

    const [, args] = spawnMock.mock.calls[0]!;
    const argsArr = args as string[];
    const iIdx = argsArr.indexOf('-i');
    expect(iIdx).toBeGreaterThan(-1);
    expect(argsArr[iIdx + 1]).toBe('~/.ssh/id_rsa');
  });

  it('user@host appears as a positional arg', async () => {
    await openAndCapture({
      host: 'borispc3.ai',
      user: 'boris',
      remoteHost: '127.0.0.1',
      remotePort: 11434,
    });

    const [, args] = spawnMock.mock.calls[0]!;
    const argsArr = args as string[];
    expect(argsArr).toContain('boris@borispc3.ai');
  });

  it('close() kills the child process', async () => {
    const { handle, child } = await openAndCapture({
      host: 'borispc3.ai',
      user: 'boris',
      remoteHost: '127.0.0.1',
      remotePort: 11434,
    });
    expect(child.killed).toBe(false);
    await handle.close();
    expect(child.killed).toBe(true);
  });

  it('close() is idempotent', async () => {
    const { handle } = await openAndCapture({
      host: 'borispc3.ai',
      user: 'boris',
      remoteHost: '127.0.0.1',
      remotePort: 11434,
    });
    await handle.close();
    await expect(handle.close()).resolves.toBeUndefined();
  });
});