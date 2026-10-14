import { spawnSync } from "node:child_process";

export interface GitRunner {
  /** Paths from `git status --porcelain` (renames reduced to the destination). */
  statusPorcelain: (cwd?: string) => string[];
  diffShortstat: (cwd?: string) => string;
}

function git(args: string[], cwd?: string): string {
  const r = spawnSync("git", args, { cwd, encoding: "utf8", maxBuffer: 10 * 1024 * 1024 });
  return r.status === 0 && typeof r.stdout === "string" ? r.stdout : "";
}

export function defaultGitRunner(): GitRunner {
  return {
    statusPorcelain: (cwd) =>
      git(["status", "--porcelain"], cwd)
        .split("\n")
        .filter(Boolean)
        .map((l) => l.slice(3).trim())
        .map((f) => (f.includes(" -> ") ? (f.split(" -> ").pop() as string) : f)),
    diffShortstat: (cwd) => git(["diff", "--shortstat", "HEAD"], cwd).trim(),
  };
}

export interface SummaryData {
  runId: string;
  agent: string;
  tier: number;
  status: "done" | "failed";
  exitCode: number;
  durationMs: number;
  cwd: string;
  verifyRan: boolean;
  verifyExitCode: number | null;
}

/** One-line JSON summary of a finished blocking run. */
export function buildSummary(data: SummaryData, runner: GitRunner): string {
  return JSON.stringify({
    runId: data.runId,
    agent: data.agent,
    tier: data.tier,
    status: data.status,
    exitCode: data.exitCode,
    durationMs: data.durationMs,
    filesChanged: runner.statusPorcelain(data.cwd),
    diffstat: runner.diffShortstat(data.cwd),
    verify: { ran: data.verifyRan, exitCode: data.verifyExitCode },
  });
}
