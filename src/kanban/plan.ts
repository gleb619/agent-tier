import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parsePlanKeywords } from "../compose/task-source";
import { KEYWORDS_HEADING, SENTINEL, TIME_HEADING } from "./types";

export interface PlanScaffold {
  id: string;
  title: string;
  description?: string;
  keywords: string[];
}

/** `a, b ,,a` → `["a", "b"]` (trimmed, deduped, blanks dropped). */
export function splitKeywords(raw: string | undefined): string[] {
  return [
    ...new Set(
      (raw ?? "")
        .split(",")
        .map((w) => w.trim())
        .filter(Boolean),
    ),
  ];
}

/** Placeholder line: `<...>` lines are ignored by the keyword parser, so an unfilled section yields none. */
const KEYWORDS_HINT = "<symbols, file paths, concepts for `at index` context scan — comma separated>";

function keywordsSection(keywords: string[]): string {
  const body = keywords.length > 0 ? `Keywords: ${keywords.join(", ")}` : KEYWORDS_HINT;
  return `${KEYWORDS_HEADING}\n\n${body}\n`;
}

/** Skeleton plan file: Keywords (read by compose) and Time (Planned by the agent, Estimated by `at`). Keywords sit first so compose's head-of-file scan always sees it. */
export function planSkeleton(p: PlanScaffold): string {
  const desc = p.description && p.description !== SENTINEL ? `${p.description}\n\n` : "";
  return `# ${p.id} — ${p.title}\n\n${desc}${keywordsSection(p.keywords)}
${TIME_HEADING}

<!-- Planned: the planning agent's commitment. Estimated: written by \`at kanban estimate\` — do not edit. -->
Planned: <duration, e.g. 45m or 1h30m>
Estimated: -

## Requirements

## Design

## Tasks

- [ ] 1.
`;
}

export type ScaffoldOutcome = "created" | "keywords-added" | "unchanged";

/**
 * Make sure the plan file exists and carries a `## Keywords` section.
 * Missing file → skeleton. Existing file without a keywords line → section inserted after the
 * title line (only when keywords were supplied). Existing keywords are never rewritten.
 */
export function ensurePlanFile(abs: string, p: PlanScaffold): ScaffoldOutcome {
  if (!existsSync(abs)) {
    mkdirSync(path.dirname(abs), { recursive: true });
    writeFileSync(abs, planSkeleton(p), "utf8");
    return "created";
  }
  if (p.keywords.length === 0) return "unchanged";
  const text = readFileSync(abs, "utf8");
  if (parsePlanKeywords(text).length > 0) return "unchanged";
  const lines = text.split("\n");
  const heading = lines.findIndex((l) => /^#{1,6}\s+keywords\s*$/i.test(l.trim()));
  if (heading !== -1) {
    lines.splice(heading + 1, 0, "", `Keywords: ${p.keywords.join(", ")}`);
    writeFileSync(abs, lines.join("\n"), "utf8");
    return "keywords-added";
  }
  const at = lines[0]?.startsWith("# ") ? 1 : 0;
  lines.splice(at, 0, "", ...keywordsSection(p.keywords).trimEnd().split("\n"), "");
  writeFileSync(abs, lines.join("\n"), "utf8");
  return "keywords-added";
}
