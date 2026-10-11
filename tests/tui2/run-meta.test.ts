import { describe, expect, it } from "vitest";
import { type RunRecord, UNNAMED_PLACEHOLDER } from "../../src/run-store";
import {
  exitCodeColor,
  isUnnamed,
  META_LABEL,
  META_VALUE_WIDTH,
  type MetaField,
  type MetaRow,
  metaLabelWidth,
  padLabel,
  padValue,
  runMetaRows,
} from "../../src/tui2/components/RunMeta";
import { formatClock, formatClockRange, formatDuration, formatExitCode } from "../../src/tui2/format";

const NOW = new Date();

/** A timestamp pinned to today's calendar date, so day buckets never depend on run time. */
const at = (hour: number, minute = 0): string =>
  new Date(NOW.getFullYear(), NOW.getMonth(), NOW.getDate(), hour, minute, 0).toISOString();

const mockRun = (runId: string, overrides: Partial<RunRecord> = {}): RunRecord => ({
  runId,
  agent: "mm-code",
  tier: 2,
  pid: 1234,
  prompt: "do the thing",
  logFile: `/tmp/${runId}.log`,
  startedAt: at(11),
  finishedAt: null,
  exitCode: null,
  status: "running",
  name: UNNAMED_PLACEHOLDER,
  ...overrides,
});

const fieldRows = (session: RunRecord): MetaField[][] =>
  runMetaRows(session)
    .filter((row): row is Extract<MetaRow, { kind: "fields" }> => row.kind === "fields")
    .map((row) => row.fields);

const byLabel = (fields: MetaField[]): Record<string, MetaField> =>
  Object.fromEntries(fields.flat().map((f) => [f.label, f]));

describe("tui2 run meta rows", () => {
  const session = mockRun("run-42", {
    agent: "kimi",
    tier: 1,
    pid: 1606355,
    status: "done",
    exitCode: 0,
    finishedAt: at(12),
    name: "Ship kanban",
  });

  it("lays the metadata out as identity, execution, outcome and timing rows", () => {
    const rows = runMetaRows(session);
    expect(rows.map((r) => r.kind)).toEqual(["identity", "fields", "fields", "fields"]);

    const identity = rows[0];
    expect(identity.kind === "identity" && identity.name).toBe("Ship kanban");
    expect(identity.kind === "identity" && identity.runId).toBe("run-42");
    expect(fieldRows(session)[0].map((f) => [f.label, f.value])).toEqual([
      ["agent", "kimi"],
      ["tier", "t1"],
      ["pid", "1606355"],
    ]);

    expect(fieldRows(session)[1].map((f) => [f.label, f.value])).toEqual([
      ["status", "✓ done"],
      ["exit", "0"],
      ["duration", formatDuration(session)],
    ]);

    expect(fieldRows(session)[2].map((f) => [f.label, f.value])).toEqual([
      ["started", formatClockRange(session.startedAt, session.finishedAt)],
    ]);
  });

  it("falls back to the run id for an unnamed run", () => {
    expect(isUnnamed(mockRun("r1"))).toBe(true);
    expect(isUnnamed(mockRun("r1", { name: "Fix lint" }))).toBe(false);

    const rows = runMetaRows(mockRun("r1"));
    expect(rows[0].kind === "identity" && rows[0].name).toBe("r1");
    // no duplicate dim id next to a headline that is already the id
    expect(rows[0].kind === "identity" && rows[0].runId).toBeNull();
  });

  it("colours the status with the shared tui2 palette", () => {
    const status = byLabel(fieldRows(session)[1]).status;
    expect(status.color).toBe("#388bfd");
    expect(status.value).toContain("done");
  });

  it("greens a zero exit code and reds a failing one", () => {
    expect(exitCodeColor(null)).toBeUndefined();
    expect(exitCodeColor(0)).toBe("#3fb950");
    expect(exitCodeColor(1)).toBe("#f85149");
  });

  it("shows a placeholder while the exit code is unknown", () => {
    expect(formatExitCode(null)).toBe("-");
    expect(formatExitCode(0)).toBe("0");
    expect(byLabel(fieldRows(mockRun("r2"))[1]).exit.value).toBe("-");
  });
});

describe("tui2 meta alignment", () => {
  const session = mockRun("run-42", { name: "Ship kanban" });

  it("derives one label column shared by every key/value row", () => {
    const rows = runMetaRows(session);
    // "duration" is the longest label, so every value starts after 8 chars.
    expect(metaLabelWidth(rows)).toBe(8);
  });

  it("pads labels out to the shared column", () => {
    expect(padLabel("agent", 8)).toBe("agent   ");
    expect(padLabel("duration", 8)).toBe("duration");
  });

  it("keeps label and value colours from the tui2 palette", () => {
    expect(META_LABEL).toBe("#8b949e");
  });

  it("aligns every key/value row to the same label width", () => {
    const width = metaLabelWidth(runMetaRows(session)) + 1;
    for (const row of fieldRows(session)) {
      for (const field of row) {
        expect(`${field.label}:`.length).toBeLessThanOrEqual(width);
      }
    }
  });
});

describe("tui2 meta value column", () => {
  it("exposes META_VALUE_WIDTH as the shared value column width", () => {
    expect(META_VALUE_WIDTH).toBe(14);
  });

  it("pads short values out to the column width", () => {
    expect(padValue("kimi")).toBe(`kimi${" ".repeat(META_VALUE_WIDTH - 4)}`);
    expect(padValue("0")).toBe(`0${" ".repeat(META_VALUE_WIDTH - 1)}`);
    expect(padValue("1606355")).toBe(`1606355${" ".repeat(META_VALUE_WIDTH - 7)}`);
  });

  it("passes through values that already meet the width", () => {
    const exact = "x".repeat(META_VALUE_WIDTH);
    expect(padValue(exact)).toBe(exact);
  });

  it("honours a caller-provided width override", () => {
    expect(padValue("a", 5)).toBe(`a${" ".repeat(4)}`);
    expect(padValue("abc", 2)).toBe("abc");
  });
});

describe("tui2 run meta row configuration", () => {
  const session = mockRun("run-42", {
    agent: "kimi",
    tier: 1,
    pid: 1606355,
    status: "done",
    exitCode: 0,
    finishedAt: at(12),
    name: "Ship kanban",
  });

  it("lets the timing row opt into a wider value column", () => {
    const fieldRowList = runMetaRows(session).filter(
      (row): row is Extract<MetaRow, { kind: "fields" }> => row.kind === "fields",
    );
    const timing = fieldRowList[fieldRowList.length - 1];
    expect(timing.valueWidth).toBeDefined();
    expect(timing.valueWidth!).toBeGreaterThanOrEqual(formatClockRange(session.startedAt, session.finishedAt).length);
  });

  it("keeps the multi-field rows on the shared value width", () => {
    const fieldRowList = runMetaRows(session).filter(
      (row): row is Extract<MetaRow, { kind: "fields" }> => row.kind === "fields",
    );
    expect(fieldRowList[0].valueWidth).toBeUndefined();
    expect(fieldRowList[1].valueWidth).toBeUndefined();
  });
});

describe("formatClockRange", () => {
  it("joins start and finish with an arrow", () => {
    expect(formatClockRange(at(10), at(11))).toBe(`${formatClock(at(10))} → ${formatClock(at(11))}`);
  });

  it("marks a still-running span", () => {
    expect(formatClockRange(at(10), null)).toBe(`${formatClock(at(10))} → running`);
  });
});
