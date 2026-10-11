import type { JSX } from "solid-js";
import { createMemo, For, Show } from "solid-js";
import type { RunRecord } from "../../run-store";
import { UNNAMED_PLACEHOLDER } from "../../run-store";
import { formatClockRange, formatDuration, formatExitCode, statusColor, statusIcon, truncate } from "../format";
import { runLabel } from "./sidebar/row-model";

/**
 * Run-details metadata block (design doc §11.2).
 *
 * The block is a borderless TABLE inside the rounded box owned by RunDetails:
 *
 *   identity    bold name + dim run id (title row above the grid)
 *   execution   agent   t1   1606355
 *   outcome     ✓ done  0    3m 05s
 *   timing      10:00 AM → 10:01 AM
 *
 * Every key/value row pads its values to a fixed column width so the cell
 * boundaries line up across rows. The "timing" row overrides the value width
 * because `formatClockRange` is longer than the shared column. The identity row
 * is not part of the column grid — it sits above with its own margin so the
 * title and the table below read as visually separate.
 *
 * Pure helpers (label width, padding, value colour) live in the exported
 * surface below so the row model stays unit-testable without a renderer.
 */

/** Same colour family as the rest of tui2: dim labels, brighter values. */
export const META_LABEL = "#8b949e";
export const META_VALUE = "#c9d1d9";
export const META_NAME = "#e6edf3";
export const META_HINT = "#6e7681";
export const META_OK = "#3fb950";

/** Shared value-column width for multi-field rows (agent/tier/pid, status/exit/duration). */
export const META_VALUE_WIDTH = 14;
/** Wider value-column width for single-field rows that need to fit clock ranges. */
export const META_VALUE_WIDTH_WIDE = 32;

/** Spacing between rows inside the metadata grid. */
const META_ROW_GAP = 1;

export interface MetaField {
  label: string;
  value: string;
  color?: string;
}

/** One metadata line: either the identity headline or an aligned key/value row. */
export type MetaRow =
  | { kind: "identity"; name: string; runId: string | null }
  | { kind: "fields"; fields: MetaField[]; valueWidth?: number };

/** Longest key label across the key/value rows — the shared label column. */
export function metaLabelWidth(rows: MetaRow[]): number {
  return rows.reduce(
    (max, row) => (row.kind === "fields" ? Math.max(max, ...row.fields.map((f) => f.label.length)) : max),
    0,
  );
}

/** Pad a key label so every value starts in the same column. */
export function padLabel(label: string, width: number): string {
  return label.padEnd(width);
}

/**
 * Pad a value string to a fixed column width. Pure — no truncation — so callers
 * own the bound on what fits in a column (multi-field rows keep within
 * `META_VALUE_WIDTH`; the timing row opts into `META_VALUE_WIDTH_WIDE`).
 */
export function padValue(value: string, width: number = META_VALUE_WIDTH): string {
  return value.padEnd(width);
}

/** Green for a clean run, red for a failure, neutral while unknown. */
export function exitCodeColor(exitCode: number | null): string | undefined {
  return exitCode === null ? undefined : exitCode === 0 ? META_OK : statusColor("failed");
}

/** True when the namer never resolved for the run yet (placeholder name). */
export function isUnnamed(session: RunRecord): boolean {
  return session.name === UNNAMED_PLACEHOLDER;
}

/** The four metadata rows for a run, in display order. */
export function runMetaRows(session: RunRecord): MetaRow[] {
  // An unnamed run already shows its id as the headline — repeating it dim would
  // just be noise, so the id cell is dropped in that case.
  const runId = isUnnamed(session) ? null : session.runId;
  return [
    { kind: "identity", name: runLabel(session), runId },
    {
      kind: "fields",
      fields: [
        { label: "agent", value: session.agent },
        { label: "tier", value: `t${session.tier}` },
        { label: "pid", value: String(session.pid) },
      ],
    },
    {
      kind: "fields",
      fields: [
        {
          label: "status",
          value: `${statusIcon(session.status)} ${session.status}`,
          color: statusColor(session.status),
        },
        { label: "exit", value: formatExitCode(session.exitCode), color: exitCodeColor(session.exitCode) },
        { label: "duration", value: formatDuration(session) },
      ],
    },
    {
      kind: "fields",
      // `formatClockRange` is wider than the shared value column, so this row
      // opts into a wider value width to keep the clock readable.
      valueWidth: META_VALUE_WIDTH_WIDE,
      fields: [{ label: "started", value: formatClockRange(session.startedAt, session.finishedAt) }],
    },
  ];
}

export interface RunMetaProps {
  /** Run whose metadata is shown. */
  session: RunRecord;
}

/** One metadata line: the bold identity headline or an aligned key/value row. */
function MetaRowView(props: { row: MetaRow; labelWidth: number }): JSX.Element {
  if (props.row.kind === "identity") {
    return (
      <box flexDirection="row" gap={2}>
        <text fg={META_NAME}>
          <b>{truncate(props.row.name, 40)}</b>
        </text>
        <Show when={props.row.runId}>{(id: () => string) => <text fg={META_HINT} content={truncate(id(), 24)} />}</Show>
      </box>
    );
  }

  const valueWidth = props.row.valueWidth ?? META_VALUE_WIDTH;

  return (
    <box flexDirection="row" gap={4}>
      <For each={props.row.fields}>
        {(field) => (
          <box flexDirection="row">
            <text fg={META_LABEL} content={padLabel(`${field.label}:`, props.labelWidth)} />
            <text content=" " />
            <text fg={field.color ?? META_VALUE} content={padValue(field.value, valueWidth)} />
          </box>
        )}
      </For>
    </box>
  );
}

/**
 * Padded, aligned metadata block for the run-details panel.
 *
 * Identity row sits above the table; grid rows below share the same label
 * column and a fixed-width value column so every label starts at the same x.
 * The surrounding bordered container in `RunDetails` provides padding, border
 * and the gap below the block — keeping the layout here purely structural
 * makes the row model easy to unit-test and lets the panel own all visual
 * chrome.
 */
export function RunMeta(props: RunMetaProps): JSX.Element {
  const rows = createMemo(() => runMetaRows(props.session));
  const labelWidth = createMemo(() => metaLabelWidth(rows()) + 1);

  return (
    <box flexDirection="column" gap={META_ROW_GAP}>
      <For each={rows()}>{(row) => <MetaRowView row={row} labelWidth={labelWidth()} />}</For>
    </box>
  );
}
