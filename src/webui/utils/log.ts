/** A numbered log line; `n` is 1-based within the buffer it belongs to. */
export interface LogLine {
  n: number;
  text: string;
}

/** Zip raw log text lines with 1-based numbers starting at `start`. */
export function toLogLines(texts: string[], start = 1): LogLine[] {
  return texts.map((text, i) => ({ n: start + i, text }));
}

/** Case-insensitive substring filter; empty/whitespace query returns everything. */
export function filterLines(lines: LogLine[], query: string): LogLine[] {
  const q = query.trim().toLowerCase();
  if (!q) return lines;
  return lines.filter((l) => l.text.toLowerCase().includes(q));
}

/** Indexes into `lines` of entries containing the query (case-insensitive); [] for empty query. */
export function findMatches(lines: LogLine[], query: string): number[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const out: number[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (lines[i]!.text.toLowerCase().includes(q)) out.push(i);
  }
  return out;
}

/** Split a line into segments so matches can be highlighted; empty query → single non-match segment. */
export function splitHighlight(text: string, query: string): { text: string; match: boolean }[] {
  const q = query.trim().toLowerCase();
  if (!q) return [{ text, match: false }];
  const segments: { text: string; match: boolean }[] = [];
  let rest = text;
  for (;;) {
    const idx = rest.toLowerCase().indexOf(q);
    if (idx === -1) break;
    if (idx > 0) segments.push({ text: rest.slice(0, idx), match: false });
    segments.push({ text: rest.slice(idx, idx + q.length), match: true });
    rest = rest.slice(idx + q.length);
  }
  if (rest.length > 0 || segments.length === 0) segments.push({ text: rest, match: false });
  return segments;
}

/**
 * Next match to jump to from `current` (a line number), wrapping around.
 * `matches` is the sorted list of matching line numbers. Returns null when
 * there are no matches.
 */
export function stepMatch(matches: number[], current: number | null, direction: 1 | -1): number | null {
  if (matches.length === 0) return null;
  if (current === null) return direction === 1 ? matches[0]! : matches[matches.length - 1]!;
  const pos = matches.indexOf(current);
  if (pos === -1) {
    if (direction === 1) return matches.find((m) => m > current) ?? matches[0]!;
    for (let i = matches.length - 1; i >= 0; i--) {
      if (matches[i]! < current) return matches[i]!;
    }
    return matches[matches.length - 1]!;
  }
  return matches[(pos + direction + matches.length) % matches.length]!;
}
