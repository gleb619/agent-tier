import type { ApiRun } from "$types/api";

export interface RunGroup {
  /** Local YYYY-MM-DD of the group. */
  key: string;
  /** Human label: Today / Yesterday / "Oct 9" / "Oct 9, 2025" (year only when it differs). */
  label: string;
  runs: ApiRun[];
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const DAY = 86400000;

/**
 * Group runs by local calendar day, newest day first. Runs are kept in input
 * order within a group (the runs store already sorts newest first).
 */
export function groupRunsByDate(runs: ApiRun[], now: Date = new Date()): RunGroup[] {
  const today = startOfDay(now).getTime();
  const groups: RunGroup[] = [];
  const byKey = new Map<string, RunGroup>();
  for (const run of runs) {
    const day = startOfDay(new Date(run.startedAt));
    const key = dateKey(day);
    let group = byKey.get(key);
    if (!group) {
      group = { key, label: dayLabel(day, today), runs: [] };
      byKey.set(key, group);
      groups.push(group);
    }
    group.runs.push(run);
  }
  return groups.sort((a, b) => b.key.localeCompare(a.key));
}

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function dateKey(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

function dayLabel(day: Date, todayStart: number): string {
  const dayStart = day.getTime();
  if (dayStart === todayStart) return "Today";
  if (dayStart === todayStart - DAY) return "Yesterday";
  const base = `${MONTHS[day.getMonth()]} ${day.getDate()}`;
  return day.getFullYear() === new Date(todayStart).getFullYear() ? base : `${base}, ${day.getFullYear()}`;
}
