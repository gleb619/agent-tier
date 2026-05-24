import { spawn } from 'child_process';
import { appendFileSync, mkdirSync } from 'fs';
import path from 'path';
import { setLogLines, refreshLog } from './store/log';
import { refreshSessions } from './store/sessions';

export interface PromptSubmitOpts {
  tier: 1 | 2 | 3 | 4;
  agent: string;
  mode: "stream" | "detached";
  retries: number;
}

export function submitPrompt(prompt: string, opts: PromptSubmitOpts): void {
  const args: string[] = ["-p", prompt, "-t", String(opts.tier)];
  if (opts.agent !== "auto") {
    args.push("-a", opts.agent);
  }
  if (opts.mode === "stream") {
    args.push("-s");
  }
  if (opts.retries > 0) {
    args.push("-r", String(opts.retries));
  }

  if (opts.mode === "detached") {
    spawn("at", args, { detached: true, stdio: "ignore" });
    setTimeout(() => refreshSessions(), 500);
  } else {
    const timestamp = Date.now();
    const logDir = "/tmp/at-logs";
    mkdirSync(logDir, { recursive: true });
    const logFile = path.join(logDir, `at-tui-${timestamp}.log`);

    const child = spawn("at", args, { detached: false, stdio: "pipe" });

    child.stdout.on("data", (data: Buffer) => {
      const lines = data.toString().split("\n");
      for (const line of lines) {
        if (line.length > 0) {
          setLogLines((prev) => [...prev, line]);
          appendFileSync(logFile, line + "\n", "utf8");
        }
      }
    });

    child.stderr.on("data", (data: Buffer) => {
      const lines = data.toString().split("\n");
      for (const line of lines) {
        if (line.length > 0) {
          setLogLines((prev) => [...prev, line]);
          appendFileSync(logFile, line + "\n", "utf8");
        }
      }
    });

    setTimeout(() => refreshSessions(), 500);
  }
}
