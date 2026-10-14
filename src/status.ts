import os from "os";
import path from "path";
import { loadGenericAgents } from "./agents/generic-loader";
import { AGENTS, type AgentDef, getAgentsByTier } from "./agents/registry";
import { getLineAgents, loadConfig } from "./config";
import { type AgentHealth, loadHealth } from "./health";
import { drainNamingQueue } from "./naming";
import { type RunRecord, refreshRuns } from "./run-store";
import { loadStateFile } from "./scheduler";
import { buildSchedulerMermaid, resolveSchedulerDiagram } from "./scheduler-diagram";
import { getStateFilePath } from "./state-dir";

// --- Data types ---

/** A run tagged with the state dir it came from (joined `at status` only). */
export type ScopedRun = RunRecord & { scope?: "project" | "global" };

export interface StatusReport {
  total: number;
  runs: RunRecord[];
  state?: StateReport;
}

export interface SchedulerEntry {
  key: string;
  index: number;
  agentName: string | null;
  /** Which state dir the entry came from (joined `at status` only). */
  scope?: "project" | "global";
}

export interface AgentHealthEntry {
  name: string;
  deactivated: boolean;
  failures: number;
  lastFailure: string | null;
  disabledTo: string | null;
}

export interface StateReport {
  scheduler: SchedulerEntry[];
  maxEntries: number | null;
  agents: AgentHealthEntry[];
}

// --- Data layer: build structured reports ---

export function buildStatusReport(runs: RunRecord[], state?: StateReport): StatusReport {
  return state ? { total: runs.length, runs, state } : { total: runs.length, runs };
}

export function buildStateReport(stateDir: string, opts?: { quiet?: boolean }): StateReport {
  const stateFilePath = getStateFilePath(stateDir);
  const state = loadStateFile(stateFilePath);
  const scheduler: SchedulerEntry[] = [];

  if (state.scheduler && Object.keys(state.scheduler).length > 0) {
    const allAgents = [...AGENTS, ...loadGenericAgents()];
    const config = loadConfig(opts);
    let lineAgents: AgentDef[] = [];
    try {
      lineAgents = getLineAgents(allAgents, config, opts);
    } catch {
      // empty/invalid line config: status must still render; "line" entry gets agentName null
    }
    for (const [key, sched] of Object.entries(state.scheduler)) {
      let agentName: string | null = null;
      if (key === "line") {
        agentName = lineAgents[sched.index]?.name ?? null;
      } else {
        const tierMatch = key.match(/^tier-([1-4])$/) || key.match(/^([1-4])$/);
        if (tierMatch) {
          const tier = Number(tierMatch[1]) as 1 | 2 | 3 | 4;
          agentName = getAgentsByTier(tier)[sched.index]?.name ?? null;
        } else {
          agentName = AGENTS[sched.index]?.name ?? null;
        }
      }
      scheduler.push({ key, index: sched.index, agentName });
    }
  }

  const health = loadHealth(stateFilePath);
  const agents: AgentHealthEntry[] = Object.entries(health.agents).map(([name, h]) => buildAgentHealthEntry(name, h));

  return { scheduler, maxEntries: state.runs?.maxEntries ?? null, agents };
}

// --- Joined (multi-dir) reports ---

function scopeOf(stateDir: string): "project" | "global" {
  return stateDir === path.join(os.homedir(), ".at") ? "global" : "project";
}

/** Merge per-dir state reports: scheduler entries keep both (scoped), agent
 *  health dedupes by name (earlier dir wins), maxEntries first non-null. */
export function buildJoinedStateReport(dirs: string[]): StateReport {
  const reports = dirs.map((d) => buildStateReport(d, { quiet: true }));
  const scheduler: SchedulerEntry[] = reports.flatMap((r, i) =>
    r.scheduler.map((e) => ({ ...e, scope: scopeOf(dirs[i]) })),
  );
  const agents: AgentHealthEntry[] = [];
  const seen = new Set<string>();
  for (const r of reports) {
    for (const a of r.agents) {
      if (!seen.has(a.name)) {
        seen.add(a.name);
        agents.push(a);
      }
    }
  }
  const maxEntries = reports.map((r) => r.maxEntries).find((m) => m != null) ?? null;
  return { scheduler, maxEntries, agents };
}

/** Build the state report for a resolved dir list: joined (scoped) when more
 *  than one dir, plain single-dir report otherwise — matches `at status --json`
 *  and the TUI dashboard. */
export function buildStateReportFor(dirs: string[]): StateReport {
  return dirs.length > 1 ? buildJoinedStateReport(dirs) : buildStateReport(dirs[0], { quiet: true });
}

/** Union of per-dir run lists, tagged with scope; dedupe by runId (earlier
 *  dir wins), newest first. Single dir: returned untouched (back-compat). */
export function joinRuns(dirs: string[], runsPerDir: RunRecord[][]): ScopedRun[] {
  if (dirs.length === 1) return runsPerDir[0];
  const byId = new Map<string, ScopedRun>();
  dirs.forEach((dir, i) => {
    const scope = scopeOf(dir);
    for (const r of runsPerDir[i] ?? []) {
      if (!byId.has(r.runId)) byId.set(r.runId, { ...r, scope });
    }
  });
  return [...byId.values()].sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime());
}

function formatIsoRelative(iso: string): string {
  const d = new Date(iso);
  const now = Date.now();
  const diffMs = d.getTime() - now;
  const absDiff = Math.abs(diffMs);

  const relative =
    absDiff < 60_000
      ? "just now"
      : absDiff < 3_600_000
        ? `${Math.floor(absDiff / 60_000)}m ${diffMs < 0 ? "ago" : "from now"}`
        : absDiff < 86_400_000
          ? `${Math.floor(absDiff / 3_600_000)}h ${diffMs < 0 ? "ago" : "from now"}`
          : `${Math.floor(absDiff / 86_400_000)}d ${diffMs < 0 ? "ago" : "from now"}`;

  const time = d.toLocaleString();
  return `${relative} (${time})`;
}

function buildAgentHealthEntry(name: string, h: AgentHealth): AgentHealthEntry {
  const sorted = [...h.failureTimes].sort();
  const lastFailure = sorted.length > 0 ? (sorted[sorted.length - 1] ?? null) : null;
  return {
    name,
    deactivated: h.deactivated === true,
    failures: h.failureTimes.length,
    lastFailure,
    disabledTo: h.disabledTo ?? null,
  };
}

// --- Formatting: text table from data ---

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const secs = seconds % 60;
  if (minutes < 60) return `${minutes}m ${secs}s`;
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return `${hours}h ${mins}m`;
}

function statusIcon(status: RunRecord["status"]): string {
  switch (status) {
    case "running":
      return "running";
    case "done":
      return "done";
    case "failed":
      return "failed";
    case "stuck":
      return "stuck";
  }
}

function padRight(s: string, len: number): string {
  return s.length >= len ? s : s + " ".repeat(len - s.length);
}

const NAME_COL_MAX = 24;

/** Truncate a session name for table display. */
function formatNameCell(name: string): string {
  if (!name) return "";
  if (name.length <= NAME_COL_MAX) return name;
  return name.slice(0, NAME_COL_MAX - 1) + "…";
}

export function formatStatusTable(runs: RunRecord[]): string {
  const headerSection = "# Runs\n\n";
  if (runs.length === 0) return headerSection + "[at] no runs found";

  const now = Date.now();
  const rows = runs.map((r) => {
    const endTime = r.finishedAt ? new Date(r.finishedAt).getTime() : now;
    const duration = formatDuration(endTime - new Date(r.startedAt).getTime());

    return {
      runId: r.runId,
      name: formatNameCell(r.name),
      agent: r.agent,
      status: statusIcon(r.status),
      duration,
      log: r.logFile,
      scope: (r as ScopedRun).scope,
    };
  });

  const showScope = rows.some((r) => r.scope);
  const colRun = Math.max(3, ...rows.map((r) => r.runId.length));
  const colName = Math.max(4, ...rows.map((r) => r.name.length));
  const colAgent = Math.max(5, ...rows.map((r) => r.agent.length));
  const colStatus = Math.max(6, ...rows.map((r) => r.status.length));
  const colDur = Math.max(8, ...rows.map((r) => r.duration.length));
  const colLog = Math.max(3, ...rows.map((r) => r.log.length));
  const colScope = Math.max(5, ...rows.map((r) => (r.scope ?? "").length));

  const header =
    "| " +
    padRight("RUN", colRun) +
    " | " +
    padRight("NAME", colName) +
    " | " +
    padRight("AGENT", colAgent) +
    " | " +
    padRight("STATUS", colStatus) +
    " | " +
    padRight("DURATION", colDur) +
    " | " +
    (showScope ? padRight("SCOPE", colScope) + " | " : "") +
    padRight("LOG", colLog) +
    " |";

  const divider =
    "| " +
    "-".repeat(colRun) +
    " | " +
    "-".repeat(colName) +
    " | " +
    "-".repeat(colAgent) +
    " | " +
    "-".repeat(colStatus) +
    " | " +
    "-".repeat(colDur) +
    " | " +
    (showScope ? "-".repeat(colScope) + " | " : "") +
    "-".repeat(colLog) +
    " |";

  const lines = rows.map(
    (r) =>
      "| " +
      padRight(r.runId, colRun) +
      " | " +
      padRight(r.name, colName) +
      " | " +
      padRight(r.agent, colAgent) +
      " | " +
      padRight(r.status, colStatus) +
      " | " +
      padRight(r.duration, colDur) +
      " | " +
      (showScope ? padRight(r.scope ?? "", colScope) + " | " : "") +
      padRight(r.log, colLog) +
      " |",
  );

  return headerSection + [header, divider, ...lines].join("\n");
}

export function formatStatusJson(runs: RunRecord[], state?: StateReport): string {
  return JSON.stringify(buildStatusReport(runs, state));
}

export function formatStateReport(stateDir: string): string {
  return formatStateReports([stateDir]);
}

export function formatStateReports(dirs: string[]): string {
  const scoped = dirs.length > 1;
  const report = scoped ? buildJoinedStateReport(dirs) : buildStateReport(dirs[0]);
  const lines: string[] = [];

  lines.push("## State");
  lines.push("");
  lines.push("**Scheduler:**");

  if (report.scheduler.length > 0) {
    for (const entry of report.scheduler) {
      const label = scoped && entry.scope ? `[${entry.scope}] ` : "";
      if (entry.agentName) {
        lines.push(`- ${label}${entry.key} → index ${entry.index} (${entry.agentName})`);
      } else {
        lines.push(`- ${label}${entry.key} → index ${entry.index}`);
      }
    }
    const mermaid = buildSchedulerMermaid(resolveSchedulerDiagram(dirs));
    if (mermaid) {
      lines.push("");
      lines.push(mermaid);
    }
  } else {
    lines.push("- (none)");
  }

  lines.push("");
  lines.push("**Config:**");
  if (report.maxEntries != null) {
    lines.push(`- max runs: ${report.maxEntries}`);
  } else {
    lines.push("- (none)");
  }

  if (report.agents.length > 0) {
    lines.push("");
    lines.push("**Agents:**");
    for (const a of report.agents) {
      const flags: string[] = [];
      if (a.deactivated) flags.push("DEACTIVATED");
      if (a.failures > 0) flags.push(`${a.failures} failures`);
      if (a.disabledTo) flags.push(`disabled until ${formatIsoRelative(a.disabledTo)}`);
      if (a.lastFailure) flags.push(`last: ${formatIsoRelative(a.lastFailure)}`);
      lines.push(flags.length > 0 ? `- ${a.name}: ${flags.join(", ")}` : `- ${a.name}: ok`);
    }
  }

  return lines.join("\n");
}

export function formatCombinedReport(stateDirs: string | string[], runs: RunRecord[]): string {
  const dirs = Array.isArray(stateDirs) ? stateDirs : [stateDirs];
  return formatStatusTable(runs) + "\n\n" + formatStateReports(dirs);
}

/**
 * The data behind one `at status` render: best-effort naming-queue drain, one
 * locked read→prune→detect→write per dir (output matches disk, no race with
 * concurrent addRun/updateRun), then the joined runs + state report. Also the
 * payload of `at bridge status get`.
 */
export async function buildStatusSnapshot(stateDirs: string | string[]): Promise<StatusReport> {
  const dirs = Array.isArray(stateDirs) ? stateDirs : [stateDirs];
  // Best-effort flush of the naming queue (jobs land there when the namer
  // lock timed out). Drain is silent and never throws — naming is
  // enrichment and must not break or add stderr noise to `at status`,
  // especially in --json mode.
  for (const dir of dirs) {
    try {
      await drainNamingQueue(dir);
    } catch {
      // ignore — status must work regardless
    }
  }
  const runsPerDir: RunRecord[][] = [];
  for (const dir of dirs) {
    runsPerDir.push(await refreshRuns(dir));
  }
  const runs = joinRuns(dirs, runsPerDir);
  return buildStatusReport(runs, buildStateReportFor(dirs));
}

export async function runStatus(stateDirs: string | string[], opts?: { json?: boolean }): Promise<void> {
  const dirs = Array.isArray(stateDirs) ? stateDirs : [stateDirs];
  const report = await buildStatusSnapshot(dirs);

  if (opts?.json) {
    process.stdout.write(JSON.stringify(report) + "\n");
    return;
  }

  console.log(formatCombinedReport(dirs, report.runs));
}
