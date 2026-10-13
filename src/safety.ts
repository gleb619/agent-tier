import { readdirSync, readFileSync } from "node:fs";
import os from "node:os";
import { getProcessTreeRssMb, isPidAlive } from "./process-utils";
import { loadRuns } from "./run-store";

/**
 * Laptop-safety guards for `at`. A runaway agent (or too many parallel ones)
 * must never be able to freeze the machine:
 *   - preflight refuses to START a run when the system is already stressed
 *   - the RSS watchdog SIGKILLs an agent process group that eats too much RAM
 *   - the max-runtime cap is enforced for detached runs too (see run-watch)
 * All limits are env-tunable; `AT_SAFETY=off` disables everything (not advised).
 */
export interface SafetyLimits {
  maxConcurrent: number;
  minAvailMb: number;
  maxStartTempC: number;
  maxLoadPerCpu: number;
  maxRssMb: number;
  maxRunMs: number;
}

function num(name: string, fallback: number): number {
  const v = Number(process.env[name]);
  return Number.isFinite(v) && v > 0 ? v : fallback;
}

export function getSafetyLimits(): SafetyLimits {
  return {
    maxConcurrent: num("AT_MAX_CONCURRENT", 4),
    minAvailMb: num("AT_MIN_AVAIL_MB", 2048),
    maxStartTempC: num("AT_MAX_START_TEMP_C", 85),
    maxLoadPerCpu: num("AT_MAX_LOAD_PER_CPU", 2.5),
    maxRssMb: num("AT_MAX_RSS_MB", 10240),
    maxRunMs: num("AT_MAX_RUN_MS", 7_200_000),
  };
}

export function safetyDisabled(): boolean {
  return process.env.AT_SAFETY === "off" || process.env.VITEST === "true";
}

export function readMemAvailableMb(): number {
  try {
    const m = /MemAvailable:\s+(\d+)\s+kB/.exec(readFileSync("/proc/meminfo", "utf8"));
    return m ? Number(m[1]) / 1024 : Number.POSITIVE_INFINITY;
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

export function readMaxTempC(): number {
  let max = 0;
  try {
    for (const z of readdirSync("/sys/class/thermal")) {
      if (!z.startsWith("thermal_zone")) continue;
      try {
        max = Math.max(max, Number(readFileSync(`/sys/class/thermal/${z}/temp`, "utf8")) / 1000);
      } catch {
        // zone unreadable
      }
    }
  } catch {
    // no thermal sysfs (container/VM)
  }
  return max;
}

export interface SystemSample {
  runningRuns: number;
  availMb: number;
  tempC: number;
  load1: number;
  cpus: number;
}

export function sampleSystem(stateDir: string): SystemSample {
  const running = loadRuns(stateDir).filter((r) => r.status === "running" && isPidAlive(r.pid)).length;
  return {
    runningRuns: running,
    availMb: readMemAvailableMb(),
    tempC: readMaxTempC(),
    load1: os.loadavg()[0] ?? 0,
    cpus: os.cpus().length || 1,
  };
}

/** Pure decision: returns a refusal reason, or null when it is safe to start. */
export function evaluatePreflight(s: SystemSample, l: SafetyLimits): string | null {
  if (s.runningRuns >= l.maxConcurrent) {
    return `${s.runningRuns} runs already running (limit ${l.maxConcurrent}, AT_MAX_CONCURRENT). Wait or 'at stop'.`;
  }
  if (s.availMb < l.minAvailMb) {
    return `only ${Math.round(s.availMb)}MB RAM available (need ${l.minAvailMb}MB, AT_MIN_AVAIL_MB).`;
  }
  if (s.tempC >= l.maxStartTempC) {
    return `system is hot (${Math.round(s.tempC)}C >= ${l.maxStartTempC}C, AT_MAX_START_TEMP_C). Let it cool down.`;
  }
  if (s.load1 > s.cpus * l.maxLoadPerCpu) {
    return `system load ${s.load1.toFixed(1)} > ${(s.cpus * l.maxLoadPerCpu).toFixed(1)} (AT_MAX_LOAD_PER_CPU).`;
  }
  return null;
}

/** How many `at` runs deep this process is (0 = started by a human/host tool). */
export function currentNestingDepth(): number {
  const d = Number(process.env.AT_DEPTH);
  return Number.isInteger(d) && d > 0 ? d : 0;
}

/**
 * An agent launched by `at` that itself runs `at` fans out recursively (each
 * level delegates again, detached) and can freeze the machine. Refuse unless
 * explicitly allowed with AT_ALLOW_NESTED=1.
 */
export function nestedRunRefusal(depth: number = currentNestingDepth()): string | null {
  if (depth < 1 || process.env.AT_ALLOW_NESTED === "1") return null;
  return "this process was started by an `at` agent (AT_DEPTH>=1); nested delegation is refused. Do the work directly instead of calling `at` (override: AT_ALLOW_NESTED=1)";
}

export function assertSafeToStart(stateDir: string): void {
  const nested = nestedRunRefusal();
  if (nested) throw new Error(`[at] refusing to start: ${nested}`);
  if (safetyDisabled()) return;
  const reason = evaluatePreflight(sampleSystem(stateDir), getSafetyLimits());
  if (reason) throw new Error(`[at] refusing to start: ${reason} (override: AT_SAFETY=off)`);
}

/**
 * Poll the RSS of `pid`'s process tree; SIGKILL its group once above the limit.
 * Returns a stop function. `onKill` receives the observed RSS in MB.
 */
export function startRssWatchdog(
  pid: number,
  onKill?: (rssMb: number) => void,
  opts: { maxRssMb?: number; intervalMs?: number; readRss?: (pid: number) => number | null } = {},
): () => void {
  if (safetyDisabled() && !opts.readRss) return () => {};
  const limit = opts.maxRssMb ?? getSafetyLimits().maxRssMb;
  const read = opts.readRss ?? getProcessTreeRssMb;
  const timer = setInterval(() => {
    const rss = read(pid);
    if (rss === null || rss <= limit) return;
    onKill?.(rss);
    for (const target of [-pid, pid]) {
      try {
        process.kill(target, "SIGKILL");
      } catch {
        // already gone / not a group leader
      }
    }
    clearInterval(timer);
  }, opts.intervalMs ?? 3000);
  timer.unref();
  return () => clearInterval(timer);
}
