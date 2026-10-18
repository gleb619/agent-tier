import { existsSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { parseDuration } from "../usage/units";
import { PLANS_DIR_REL, SENTINEL, TIME_HEADING } from "./types";

/**
 * The `## Time` section of a plan file:
 *
 *     ## Time
 *     Planned: 45m        <- written by the planning agent
 *     Estimated: 52m      <- written by `at` (calibrated from past runs), never by hand
 */
export interface PlanTime {
  hasSection: boolean;
  /** Raw field text; null when absent, `-` or a `<placeholder>`. */
  planned: string | null;
  estimated: string | null;
}

export type TimeField = "Planned" | "Estimated";

const HEADING_RE = /^#{1,6}\s+time\s*$/i;
const FIELD_RE = /^\s*(?:[-*]\s+)?(?:\*\*)?(Planned|Estimated)(?:\*\*)?\s*:\s*(.*?)\s*$/i;

function fieldValue(raw: string): string | null {
  const v = raw.replace(/`/g, "").trim();
  return v === "" || v === SENTINEL || v.startsWith("<") ? null : v;
}

/** Index range [start, end) of the Time section body (after the heading), or null. */
function sectionRange(lines: string[]): [number, number] | null {
  const start = lines.findIndex((l) => HEADING_RE.test(l.trim()));
  if (start === -1) return null;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (/^#{1,6}\s/.test(lines[i].trim())) {
      end = i;
      break;
    }
  }
  return [start + 1, end];
}

export function parsePlanTime(text: string): PlanTime {
  const lines = text.split("\n");
  const range = sectionRange(lines);
  const out: PlanTime = { hasSection: range !== null, planned: null, estimated: null };
  if (!range) return out;
  for (const line of lines.slice(range[0], range[1])) {
    const m = FIELD_RE.exec(line);
    if (!m) continue;
    const value = fieldValue(m[2]);
    if (m[1].toLowerCase() === "planned") out.planned = value;
    else out.estimated = value;
  }
  return out;
}

/** Replace the field line inside the Time section, or add it (creating the section at the end if needed). */
export function setPlanTimeField(text: string, field: TimeField, value: string): string {
  const lines = text.split("\n");
  const range = sectionRange(lines);
  const line = `${field}: ${value}`;
  if (!range) {
    const base = text.endsWith("\n") || text === "" ? text : `${text}\n`;
    return `${base}\n${TIME_HEADING}\n\n${line}\n`;
  }
  for (let i = range[0]; i < range[1]; i++) {
    const m = FIELD_RE.exec(lines[i]);
    if (m && m[1].toLowerCase() === field.toLowerCase()) {
      lines[i] = line;
      return lines.join("\n");
    }
  }
  // Insert after the last non-blank line of the section body.
  let at = range[0];
  for (let i = range[0]; i < range[1]; i++) if (lines[i].trim() !== "") at = i + 1;
  lines.splice(at, 0, line);
  return lines.join("\n");
}

export interface PlanTimeIssue {
  message: string;
}

/**
 * Lint a plan's Time section. Backlog tasks only need the section to exist (the planner fills
 * `Planned` before work starts); any started task must carry a valid `Planned`. `Estimated`,
 * when present, must be a valid duration. Done tasks are exempt (legacy plans predate the section).
 */
export function checkPlanTime(text: string, status: string): string[] {
  if (status === "Done") return [];
  const t = parsePlanTime(text);
  if (!t.hasSection) return [`missing '${TIME_HEADING}' section (Planned: <duration>)`];
  const out: string[] = [];
  if (t.planned === null) {
    if (status !== "Backlog") out.push("Time section has no 'Planned' duration");
  } else if (parseDuration(t.planned) === null) {
    out.push(`Time 'Planned: ${t.planned}' is not a duration (use e.g. 45m, 2h, 1h30m)`);
  }
  if (t.estimated !== null && parseDuration(t.estimated) === null) {
    out.push(`Time 'Estimated: ${t.estimated}' is not a duration`);
  }
  return out;
}

/**
 * Locate a task's plan file on disk, trying (in order) the path as given against the board dir and
 * the repo root, then an `<ID>-*` file in docs/plans (`clean` leaves those behind, slugs drift).
 */
export function findPlanFile(plan: string, id: string, root: string, boardDir?: string): string | null {
  const cleaned = plan.replace(/`/g, "").trim();
  if (!cleaned || cleaned === SENTINEL) return null;
  const candidates = path.isAbsolute(cleaned)
    ? [cleaned]
    : [...(boardDir ? [path.resolve(boardDir, cleaned)] : []), path.resolve(root, cleaned)];
  for (const c of candidates) if (existsSync(c) && statSync(c).isFile()) return c;

  const plansDir = path.join(root, PLANS_DIR_REL);
  if (existsSync(plansDir)) {
    const hit = readdirSync(plansDir).find((n) => n.startsWith(`${id}-`) && statSync(path.join(plansDir, n)).isFile());
    if (hit) return path.join(plansDir, hit);
  }
  return null;
}
