import { For, Show, createEffect, createMemo } from 'solid-js';
import type { JSX } from 'solid-js';
import type { RunRecord } from '../../run-store';
import { sessions } from '../../tui/store/sessions';
import { goToTail, isLoading, logLines, scrollOffset, VISIBLE_LINES } from '../../tui/store/log';
import { setShowPromptOverlay } from '../store/ui';
import { formatClock, formatDuration, lineColor, statusColor, statusIcon, truncate } from '../format';

export interface RunDetailsProps {
  /** Run to render; null when nothing is selected. */
  runId: string | null;
  /** Log pane owns the keyboard (j/k scroll instead of run navigation). */
  focused: boolean;
  /** Show the submitted prompt above the log (design doc §11.2). */
  showPrompt: boolean;
}

export interface MetaField {
  label: string;
  value: string;
  color?: string;
}

/** run/name/agent/tier/pid on the first row, the rest below. */
const ROW_LIMIT = 5;

/** Session metadata header, split across two compact rows. Pure. */
export function metadataFields(session: RunRecord): MetaField[] {
  return [
    { label: 'run', value: session.runId },
    { label: 'name', value: session.name },
    { label: 'agent', value: session.agent },
    { label: 'tier', value: `t${session.tier}` },
    { label: 'pid', value: String(session.pid) },
    { label: 'status', value: `${statusIcon(session.status)} ${session.status}`, color: statusColor(session.status) },
    { label: 'code', value: String(session.exitCode ?? '-') },
    { label: 'duration', value: formatDuration(session) },
    { label: 'started', value: formatClock(session.startedAt) },
    { label: 'finished', value: formatClock(session.finishedAt) },
  ];
}

export function splitFields(fields: MetaField[]): MetaField[][] {
  return [fields.slice(0, ROW_LIMIT), fields.slice(ROW_LIMIT)];
}

function Meta(props: MetaField): JSX.Element {
  return (
    <box flexDirection="row" gap={1}>
      <text fg="#484f58" content={`${props.label}:`} />
      <text fg={props.color ?? '#c9d1d9'} content={truncate(props.value, 28)} />
    </box>
  );
}

export function RunDetails(props: RunDetailsProps): JSX.Element {
  const session = createMemo(
    (): RunRecord | null => (props.runId ? sessions().find((s) => s.runId === props.runId) ?? null : null),
  );

  const rows = createMemo(() => (session() ? splitFields(metadataFields(session()!)) : []));

  const visible = createMemo((): [number, string][] => {
    const from = scrollOffset();
    return logLines()
      .slice(from, from + VISIBLE_LINES)
      .map((line, i) => [from + i + 1, line]);
  });

  // Running sessions stay pinned to the newest output, as in the classic TUI.
  createEffect(() => {
    if (session()?.status === 'running' && logLines().length > 0) {
      goToTail();
    }
  });

  return (
    <box
      title={session() ? `Run — ${truncate(session()!.runId, 24)}` : 'Run Details'}
      border
      borderStyle="single"
      borderColor={props.focused ? '#00aaff' : '#555555'}
      focused={props.focused}
      flexDirection="column"
      flexGrow={1}
      padding={1}
    >
      <Show
        when={session()}
        fallback={
          <text
            fg="#484f58"
            content="  (no run selected — j/k in the sidebar picks one, Enter opens Run Details)"
          />
        }
      >
        <box flexDirection="column" paddingBottom={1}>
          <For each={rows()}>
            {(row) => (
              <box flexDirection="row" gap={3}>
                <For each={row}>{(field) => <Meta {...field} />}</For>
              </box>
            )}
          </For>
        </box>

        <Show when={props.showPrompt}>
          <box
            flexDirection="column"
            border
            borderStyle="rounded"
            borderColor="#30363d"
            paddingX={1}
            maxHeight={10}
          >
            <text fg="#58a6ff">
              <b>Submitted prompt</b>
            </text>
            <scrollbox flexGrow={1}>
              <text content={session()?.prompt ?? '(no prompt)'} fg="#c9d1d9" />
            </scrollbox>
          </box>
        </Show>

        <scrollbox flexGrow={1}>
          <Show
            when={logLines().length > 0}
            fallback={<text fg="#484f58" content="(no log output yet)" />}
          >
            <For each={visible()}>
              {([idx, line]) => (
                <text content={`${String(idx).padStart(4, ' ')} | ${line}`} fg={lineColor(line)} />
              )}
            </For>
          </Show>
        </scrollbox>

        <box flexDirection="row" gap={2} paddingTop={1}>
          <text content={session()?.logFile ?? ''} fg="#484f58" />
          <text
            content={props.showPrompt ? '[hide prompt]' : '[show prompt]'}
            fg="#58a6ff"
            onMouseDown={() => setShowPromptOverlay((v) => !v)}
          />
          <text content={isLoading() ? '◯' : '●'} fg={statusColor(session()?.status ?? 'done')} />
        </box>
      </Show>
    </box>
  );
}
