/**
 * SSH local-forward tunnel helper (T04) — boris3pc / any SSH-reachable host.
 *
 * `spawn('ssh', ['-N', '-L', '<localPort>:<remoteHost>:<remotePort>', ...])`,
 * picking a free local port via `net.createServer().listen(0)` then closing
 * that probe server. The tunnel child outlives the probe; `close()` sends
 * SIGTERM (with a SIGKILL fallback) so callers don't have to.
 *
 * On spawn error (no pid returned) the function throws; the orchestrator
 * (T08) catches and marks the dependent provider unavailable.
 */

import { spawn, ChildProcess } from 'child_process';
import { createServer } from 'net';

export interface OpenSshTunnelOpts {
  host: string;
  user: string;
  /** Remote SSH port (defaults to 22). */
  port?: number;
  identityFile?: string;
  remoteHost: string;
  remotePort: number;
}

export interface SshTunnelHandle {
  /** e.g. `http://127.0.0.1:35421` — ready to use as a base URL. */
  localUrl: string;
  /** Terminates the tunnel; safe to call more than once. */
  close(): Promise<void>;
}

const DEFAULT_SSH_PORT = 22;

export async function openSshTunnel(opts: OpenSshTunnelOpts): Promise<SshTunnelHandle> {
  const localPort = await pickFreePort();

  const args: string[] = [
    '-N',
    '-L',
    `${localPort}:${opts.remoteHost}:${opts.remotePort}`,
  ];
  if (opts.port !== undefined && opts.port !== DEFAULT_SSH_PORT) {
    args.push('-p', String(opts.port));
  }
  args.push(`${opts.user}@${opts.host}`);
  if (opts.identityFile) {
    args.push('-i', opts.identityFile);
  }
  // Avoid terminal allocation / interactive prompts
  args.push('-o', 'BatchMode=yes');
  args.push('-o', 'ExitOnForwardFailure=yes');

  const child = spawn('ssh', args, {
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  if (!child.pid) {
    throw new Error('ssh tunnel: spawn returned no pid');
  }

  let closed = false;
  const close = async (): Promise<void> => {
    if (closed) return;
    closed = true;
    await terminateChild(child);
  };

  return {
    localUrl: `http://127.0.0.1:${localPort}`,
    close,
  };
}

/** Pick a free TCP port by binding on 0 and closing immediately. */
function pickFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.unref();
    server.once('error', reject);
    server.listen(0, () => {
      const addr = server.address();
      if (addr && typeof addr === 'object') {
        const port = addr.port;
        server.close(() => resolve(port));
      } else {
        server.close();
        reject(new Error('ssh tunnel: could not determine free port'));
      }
    });
  });
}

/** SIGTERM with SIGKILL fallback after 1s. */
function terminateChild(child: ChildProcess): Promise<void> {
  return new Promise((resolve) => {
    if (child.exitCode !== null || child.signalCode !== null) {
      return resolve();
    }
    let settled = false;
    const done = () => {
      if (settled) return;
      settled = true;
      resolve();
    };
    child.once('exit', () => done());
    try { child.kill('SIGTERM'); } catch { done(); return; }
    setTimeout(() => {
      try { child.kill('SIGKILL'); } catch { /* already dead */ }
      done();
    }, 1000).unref();
  });
}