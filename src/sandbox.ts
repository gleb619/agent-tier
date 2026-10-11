import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { AgentError } from "./agent-error";

export interface SandboxOptions {
  prompt?: string;
  timeoutMs?: number;
  /** Path to the `at` CLI entry point. Defaults to `dist/cli.js` next to the compiled runner. */
  cliPath?: string;
  /** Override the node binary used to launch the CLI (defaults to `process.execPath`). */
  bin?: string;
}

/**
 * Spawn a real `at -a <agent> --wait --timeout <ms>` call inside a fresh
 * `/tmp/at-sandbox-*` directory to verify the agent is alive. Non-zero exit
 * throws `AgentError` so the caller can route the failure through the same
 * retry-with-next-agent path that real run failures use.
 *
 * Intentionally side-effect-only: it does not consume config or scheduler
 * state — it's a real subprocess so the agent is exercised end-to-end.
 */
export async function runSandboxTest(agentName: string, opts: SandboxOptions = {}): Promise<void> {
  const cliPath = opts.cliPath ?? path.join(__dirname, "..", "dist", "cli.js");
  const bin = opts.bin ?? process.execPath;
  const prompt = opts.prompt ?? "Reply with the word OK and nothing else.";
  const timeoutMs = opts.timeoutMs ?? 300000;

  const cwd = mkdtempSync(path.join(os.tmpdir(), "at-sandbox-"));
  try {
    const child = spawn(bin, [cliPath, "-a", agentName, "-p", prompt, "--wait", "--timeout", String(timeoutMs)], {
      cwd,
      stdio: "ignore",
    });

    const code: number = await new Promise((resolve, reject) => {
      child.once("error", (err) => reject(err));
      child.once("close", (c) => resolve(c ?? 1));
    });

    if (code !== 0) {
      throw new AgentError(`sandbox test failed for ${agentName} (exit ${code})`, code);
    }
  } finally {
    try {
      rmSync(cwd, { recursive: true, force: true });
    } catch {
      /* best effort */
    }
  }
}
