import { For, Show, createMemo } from 'solid-js';
import type { JSX } from 'solid-js';
import type { RunRecord } from '../../run-store';
import { UNNAMED_PLACEHOLDER } from '../../run-store';
import { runLabel } from './sidebar/row-model';
import { formatClockRange, formatDuration, formatExitCode, statusColor, statusIcon, truncate } from '../format';

/**
 * Run-details metadata block (design doc §11.2).
 *
 * The header used to be a flat `label: value` dump spread over two rows; it now
 * renders as one indented, gap-separated block:
 *
 *   identity   run name (bold) + run id (dim)
 *   execution  agent · tier · pid
 *   outcome    status · exit · duration
 *   timing     started → finished
 *
 * All label formatting lives in the exported pure helpers below so it can be
 * unit-tested without a renderer.
 */

/** Same colour family as the rest of tui2: dim labels, brighter values. */
export const META_LABEL = '#8b949e';
export const META_VALUE = '#c9d1d9';
export const META_NAME = '#e6edf3';
export const META_HINT = '#6e7681';
export const META_OK = '#3fb950';

export interface MetaField {
  label: string;
  value: string;
  color?: string;
}

/** One metadata line: either the identity headline or an aligned key/value row. */
export type MetaRow =
  | { kind: 'identity'; name: string; runId: string | null }
  | { kind: 'fields'; fields: MetaField[] };

/** Longest key label across the key/value rows — the shared value column. */
export function metaLabelWidth(rows: MetaRow[]): number {
  return rows.reduce(
    (max, row) => (row.kind === 'fields' ? Math.max(max, ...row.fields.map((f) => f.label.length)) : max),
    0,
  );
}

/** Pad a key label so every value starts in the same column. */
export function padLabel(label: string, width: number): string {
  return label.padEnd(width);
}

/** Green for a clean run, red for a failure, neutral while unknown. */
export function exitCodeColor(exitCode: number | null): string | undefined {
  return exitCode === null ? undefined : exitCode === 0 ? META_OK : statusColor('failed');
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
    { kind: 'identity', name: runLabel(session), runId },
    {
      kind: 'fields',
      fields: [
        { label: 'agent', value: session.agent },
        { label: 'tier', value: `t${session.tier}` },
        { label: 'pid', value: String(session.pid) },
      ],
    },
    {
      kind: 'fields',
      fields: [
        { label: 'status', value: `${statusIcon(session.status)} ${session.status}`, color: statusColor(session.status) },
        { label: 'exit', value: formatExitCode(session.exitCode), color: exitCodeColor(session.exitCode) },
        { label: 'duration', value: formatDuration(session) },
      ],
    },
    {
      kind: 'fields',
      fields: [
        { label: 'started', value: formatClockRange(session.startedAt, session.finishedAt) },
      ],
    },
  ];
}

export interface RunMetaProps {
  /** Run whose metadata is shown. */
  session: RunRecord;
}

/** One metadata line: the bold identity headline or an aligned key/value row. */
function MetaRowView(props: { row: MetaRow; width: number }): JSX.Element {
  if (props.row.kind === 'identity') {
    return (
      <box flexDirection="row" gap={2}>
        <text fg={META_NAME}>
          <b>{truncate(props.row.name, 40)}</b>
        </text>
        <Show when={props.row.runId}>
          {(id: () => string) => <text fg={META_HINT} content={truncate(id(), 24)} />}
        </Show>
      </box>
    );
  }

  return (
    <box flexDirection="row" gap={4}>
      <For each={props.row.fields}>
        {(field) => (
          <box flexDirection="row" gap={2}>
            <text fg={META_LABEL} content={padLabel(`${field.label}:`, props.width)} />
            <text fg={field.color ?? META_VALUE} content={field.value} />
          </box>
        )}
      </For>
    </box>
  );
}

/**
 * Padded, aligned metadata block for the run-details panel.
 *
 * The component itself renders the rows without any padding — the surrounding
 * bordered container in `RunDetails` provides padding, border and the gap
 * below the block. Keeping the layout here purely structural makes the row
 * model easy to unit-test and lets the panel own all visual chrome.
 */
export function RunMeta(props: RunMetaProps): JSX.Element {
  const rows = createMemo(() => runMetaRows(props.session));
  const width = createMemo(() => metaLabelWidth(rows()) + 1);

  return (
    <box flexDirection="column" gap={1}>
      <For each={rows()}>{(row) => <MetaRowView row={row} width={width()} />}</For>
    </box>
  );
}

