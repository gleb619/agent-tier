import { parseDuration } from "../usage/units";
import { parsePlanTime } from "./plan-time";
import { BACKLOG, DONE } from "./types";

/** Required plan-file sections, in skeleton order. `Time` is validated by `checkPlanTime`. */
export const REQUIRED_SECTIONS = ["Goal", "Steps", "Done when", "Time"] as const;
/** Planned must leave at least this long per step. */
const MIN_MS_PER_STEP = 2 * 60_000;
/** Warn when Steps count exceeds Done-when bullet count by more than this ratio. */
const MAX_STEPS_PER_CRITERION = 3;

const HEADING_RE = /^#{1,6}\s+(.*?)\s*:?\s*$/;
const CHECKBOX_RE = /^[-*]\s+\[[ xX]\]\s*(.*)$/;
const BULLET_RE = /^(?:[-*]|\d+\.)\s+(.*)$/;
const PLACEHOLDER_RE = /^<.*>$/;

/** Pattern that matches concrete symbol/path keywords: contains `.`, `/`, camelCase, SCREAMING_CASE, or snake_case. */
const SYMBOL_RE = /[./]|[a-z][A-Z]|[A-Z]{2,}|_[a-zA-Z]/;

type Sections = Map<string, string[]>;

/** Heading (lowercased) → body lines, skipping fenced code; HTML comments and `<...>` placeholder lines dropped. */
function sections(text: string): Sections {
  const out: Sections = new Map();
  let cur: string[] | null = null;
  let fenced = false;
  let comment = false;
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (line.startsWith("```")) {
      fenced = !fenced;
      continue;
    }
    if (fenced) continue;
    if (comment) {
      if (line.includes("-->")) comment = false;
      continue;
    }
    if (line.startsWith("<!--")) {
      if (!line.includes("-->")) comment = true;
      continue;
    }
    const h = HEADING_RE.exec(line);
    if (h && line.startsWith("#")) {
      cur = [];
      if (!out.has(h[1].toLowerCase())) out.set(h[1].toLowerCase(), cur);
      continue;
    }
    if (cur && line && !/^<[^>]*>$/.test(line)) cur.push(line);
  }
  return out;
}

/** Extract individual keyword tokens from a Keywords body. */
function extractKeywords(body: string[]): string[] {
  return body.flatMap((l) =>
    l
      .replace(/^(?:[-*]\s+)?keywords\s*:/i, "")
      .split(",")
      .map((w) => w.trim())
      .filter(Boolean),
  );
}

/** Keywords body text: `Keywords: a, b` line, bullets or comma list; anything but a placeholder counts. */
function hasKeywords(body: string[]): boolean {
  return extractKeywords(body).some((w) => w !== "");
}

/**
 * Check whether keywords contain at least one concrete symbol/path reference.
 * Returns a warning message when all keywords are plain prose, or null when they look actionable.
 */
export function checkKeywordsQuality(body: string[]): string | null {
  const kws = extractKeywords(body);
  if (kws.length === 0) return null; // already caught by hasKeywords
  const hasSymbol = kws.some((w) => SYMBOL_RE.test(w));
  if (!hasSymbol) {
    return `Keywords has no file paths or symbol names — codegraph needs concrete references (e.g. src/runner.ts, schedulerNext)`;
  }
  return null;
}

/**
 * Lint a plan file's structure. Backlog / In Progress / Blocked are enforced; Done is exempt (legacy plans).
 * `Time` content is `checkPlanTime`'s job — only the cross-check against step count lives here.
 */
export function checkPlanStructure(text: string, status: string): string[] {
  if (status === DONE) return [];
  const strict = status !== BACKLOG;
  const secs = sections(text);
  const out: string[] = [];
  for (const name of REQUIRED_SECTIONS) {
    if (name === "Time") continue;
    const body = secs.get(name.toLowerCase());
    if (!body) out.push(`missing '${name}' section (## ${name})`);
    else if (strict && body.length === 0) out.push(`'${name}' section is empty`);
  }
  // Backlog plans may still be a fresh skeleton: only the headings are required until work starts.
  if (!strict) return out;

  const steps = secs.get("steps") ?? [];
  let checkboxes = 0;
  for (const l of steps) {
    const m = CHECKBOX_RE.exec(l);
    if (!m) {
      if (BULLET_RE.test(l)) out.push(`Steps item '${l}' is not a checkbox ('- [ ] ...')`);
      continue;
    }
    const item = m[1].replace(/^\d+\.?$/, "").trim();
    if (item === "" || PLACEHOLDER_RE.test(item)) out.push("Steps has an empty step ('- [ ] 1.')");
    else checkboxes += 1;
  }
  if (steps.length > 0 && checkboxes === 0 && !out.some((m) => m.startsWith("Steps"))) {
    out.push("Steps has no checkbox items ('- [ ] ...')");
  }

  const done = secs.get("done when");
  let doneWhenBullets = 0;
  if (
    done &&
    done.length > 0 &&
    !done.some((l) => {
      const t = (BULLET_RE.exec(l)?.[1] ?? "").trim();
      const ok = t !== "" && !PLACEHOLDER_RE.test(t);
      if (ok) doneWhenBullets += 1;
      return ok;
    })
  ) {
    out.push("'Done when' needs at least one bullet");
  } else {
    // Re-count in case the some() short-circuited; we need the full count for ratio check.
    doneWhenBullets = (done ?? []).filter((l) => {
      const t = (BULLET_RE.exec(l)?.[1] ?? "").trim();
      return t !== "" && !PLACEHOLDER_RE.test(t);
    }).length;
  }

  // Guard: Steps count must not exceed Done-when bullet count by more than MAX_STEPS_PER_CRITERION.
  // Catches plans with many steps but a single vague acceptance criterion.
  if (checkboxes > 0 && doneWhenBullets > 0 && checkboxes > doneWhenBullets * MAX_STEPS_PER_CRITERION) {
    out.push(
      `Steps (${checkboxes}) far exceeds 'Done when' criteria (${doneWhenBullets}) — add acceptance criteria (aim for ≤ ${MAX_STEPS_PER_CRITERION} steps per criterion)`,
    );
  }

  const kwBody = secs.get("keywords") ?? [];
  if (!hasKeywords(kwBody)) {
    out.push("missing or empty 'Keywords' (compose seeds codegraph context from it)");
  } else {
    // Keywords exist — check quality: at least one should be a symbol/path, not pure prose.
    const qualityWarn = checkKeywordsQuality(kwBody);
    if (qualityWarn) out.push(qualityWarn);
  }

  const planned = parsePlanTime(text).planned;
  const ms = planned === null ? null : parseDuration(planned);
  if (ms !== null && checkboxes > 0 && ms < checkboxes * MIN_MS_PER_STEP) {
    out.push(`Planned ${planned} is too small for ${checkboxes} steps (need ≥ 2m per step)`);
  }
  return out;
}
