/**
 * Ollama-over-SSH provider (T05) — boris3pc / any SSH-reachable ollama host.
 *
 * Composes T02's `OllamaProvider` with T04's `openSshTunnel`. The tunnel
 * lifetime is one run: opened lazily on first `isAvailable`, cached for the
 * lifetime of the provider, closed by `dispose`. Re-opening after dispose
 * is supported (useful when the orchestrator re-tries after a network blip).
 */

import type { NamerProvider } from '../types';
import { OllamaProvider } from './ollama';
import { openSshTunnel, type SshTunnelHandle } from '../ssh-tunnel';

export interface OllamaSshTunnelOptions {
  name?: string;
  ssh: { host: string; user: string; port?: number; identityFile?: string };
  /** Remote ollama base URL, e.g. `http://127.0.0.1:11434`. */
  remoteUrl: string;
  model: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
  /** Injectable tunnel opener for tests. Defaults to `openSshTunnel`. */
  openTunnel?: typeof openSshTunnel;
}

const DEFAULT_NAME = 'ollama-ssh-tunnel';
const DEFAULT_TIMEOUT_MS = 4000;

export class OllamaSshTunnelProvider implements NamerProvider {
  readonly name: string;
  private readonly sshConfig: OllamaSshTunnelOptions['ssh'];
  private readonly remoteUrl: string;
  private readonly model: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;
  private readonly openTunnelFn: typeof openSshTunnel;
  private tunnel: SshTunnelHandle | null = null;

  constructor(opts: OllamaSshTunnelOptions) {
    this.name = opts.name ?? DEFAULT_NAME;
    this.sshConfig = opts.ssh;
    this.remoteUrl = opts.remoteUrl;
    this.model = opts.model;
    this.timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.fetchImpl = opts.fetchImpl ?? globalThis.fetch;
    this.openTunnelFn = opts.openTunnel ?? openSshTunnel;
  }

  async isAvailable(signal: AbortSignal): Promise<boolean> {
    const t = await this.ensureTunnel(signal);
    if (!t) return false;
    try {
      const res = await this.fetchImpl(`${t.localUrl}/api/tags`, { signal });
      return !!res && res.ok === true;
    } catch {
      return false;
    }
  }

  async generate(prompt: string, signal: AbortSignal): Promise<string | null> {
    const t = await this.ensureTunnel(signal);
    if (!t) return null;
    // Delegate to OllamaProvider with the tunnel's local URL
    const inner = new OllamaProvider({
      url: t.localUrl,
      model: this.model,
      timeoutMs: this.timeoutMs,
      fetchImpl: this.fetchImpl,
    });
    return inner.generate(prompt, signal);
  }

  async dispose(): Promise<void> {
    if (this.tunnel) {
      const t = this.tunnel;
      this.tunnel = null;
      await t.close();
    }
  }

  /** Open the tunnel if not already open. Returns null on failure (does not throw). */
  private async ensureTunnel(_signal: AbortSignal): Promise<SshTunnelHandle | null> {
    if (this.tunnel) return this.tunnel;
    try {
      const u = new URL(this.remoteUrl);
      const remoteHost = u.hostname || '127.0.0.1';
      const remotePort = u.port ? Number(u.port) : 11434;
      const t = await this.openTunnelFn({
        host: this.sshConfig.host,
        user: this.sshConfig.user,
        port: this.sshConfig.port,
        identityFile: this.sshConfig.identityFile,
        remoteHost,
        remotePort,
      });
      this.tunnel = t;
      return t;
    } catch {
      return null;
    }
  }
}