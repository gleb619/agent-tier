import { readFileSync, readdirSync } from 'fs';
// ^ readdirSync used to enumerate /proc/*/stat for descendants.

/**
 * Milliseconds per clock tick (CLK_TCK). On Linux this is typically 10ms
 * (USER_HZ=100), exposed as `getconf CLK_TCK`. Used to convert jiffies
 * read from /proc/<pid>/stat into milliseconds.
 */
export function getClockTickMs(): number {
  // Hardcoded default for Linux; safe fallback if /proc read fails.
  // 10ms is the canonical USER_HZ value on all common Linux configs.
  return 10;
}

export function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

interface ProcStat {
  ppid: number;
  utime: number;
  stime: number;
}

/**
 * Parse /proc/<pid>/stat. Returns null if the file is unreadable or malformed.
 * The `comm` field is wrapped in parens and may contain spaces/parens, so we
 * find the last `)` and parse fields after it.
 */
function readProcStat(pid: number): ProcStat | null {
  try {
    const raw = readFileSync(`/proc/${pid}/stat`, 'utf8');
    const closeParen = raw.lastIndexOf(')');
    if (closeParen < 0) return null;
    const fields = raw.slice(closeParen + 1).trim().split(/\s+/);
    // After the closing paren, fields are indexed starting at 3 in the
    // canonical /proc layout (state=3, ppid=4, ..., utime=14, stime=15).
    // The slice above drops fields 1 and 2 (pid + comm), so fields[0] = state,
    // fields[1] = ppid, fields[11] = utime, fields[12] = stime.
    const ppid = Number(fields[1]);
    const utime = Number(fields[11]);
    const stime = Number(fields[12]);
    if (!Number.isFinite(ppid) || !Number.isFinite(utime) || !Number.isFinite(stime)) {
      return null;
    }
    return { ppid, utime, stime };
  } catch {
    return null;
  }
}

/**
 * Collect all PIDs in the subtree rooted at `rootPid` (including root).
 * Walks /proc and builds a child map by parsing ppid from each /proc/<pid>/stat,
 * then BFS-down from root. Returns null if root itself is unreadable.
 */
function collectProcessTree(rootPid: number): number[] | null {
  const root = readProcStat(rootPid);
  if (!root) return null;
  const childrenByPpid = new Map<number, number[]>();
  let dirents: string[];
  try {
    dirents = readdirSync('/proc');
  } catch {
    return [rootPid];
  }
  for (const entry of dirents) {
    if (!/^\d+$/.test(entry)) continue;
    const pid = Number(entry);
    const stat = readProcStat(pid);
    if (!stat) continue;
    const list = childrenByPpid.get(stat.ppid);
    if (list) {
      list.push(pid);
    } else {
      childrenByPpid.set(stat.ppid, [pid]);
    }
  }
  const result: number[] = [];
  const visited = new Set<number>();
  const queue: number[] = [rootPid];
  while (queue.length > 0) {
    const pid = queue.shift()!;
    if (visited.has(pid)) continue;
    visited.add(pid);
    result.push(pid);
    const kids = childrenByPpid.get(pid);
    if (kids) queue.push(...kids);
  }
  return result;
}

/**
 * Total CPU time consumed by `pid` and all descendants, in milliseconds.
 * Returns null if /proc is unreadable for the root pid (process gone or no
 * permission). Walking the full tree matters for agent runners that block
 * on a child (e.g. mm-code → claude subprocess) — only descendants show CPU.
 */
export function getProcessTicks(pid: number): number | null {
  const pids = collectProcessTree(pid);
  if (!pids) return null;
  const tickMs = getClockTickMs();
  let total = 0;
  for (const p of pids) {
    const stat = readProcStat(p);
    if (!stat) continue;
    total += (stat.utime + stat.stime) * tickMs;
  }
  return total;
}