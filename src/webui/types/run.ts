export type RunStatus = "pending" | "running" | "done" | "failed" | "killed" | "stuck";

export interface Run {
  id: string;
  name: string;
  agent: string;
  tier: number;
  status: RunStatus;
  exitCode: number | null;
  pid: number | null;
  startedAt: Date;
  finishedAt: Date | null;
  duration: number; // in seconds
  prompt: string;
  log: string[];
  metadata: RunMetadata;
}

export interface RunMetadata {
  retries: number;
  mode: "stream" | "block" | "detached";
  sandbox?: boolean;
}

export interface RunConfig {
  tier: number;
  agent: string;
  mode: "stream" | "block" | "detached";
  retries: number;
}
