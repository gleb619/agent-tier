import { For, Show, createMemo, createEffect } from "solid-js";
import type { JSX } from "solid-js";
import { filteredLines, logFilter, setLogFilter, scrollOffset, currentLogFile, goToHead, goToTail, VISIBLE_LINES, isLoading, logLines, showPrompt, setShowPrompt } from "../store/log";
import { selectedSession, showDashboard, sessions } from "../store/sessions";
import { buildStatusReport, buildStateReport } from "../../status";
import type { StatusReport, StateReport } from "../../status";
import { resolveStateDir } from "../../state-dir";

export function lineColor(line: string): string {
  if (/\[ERROR\]|\[FAIL\]|error|Error/.test(line)) return "#f85149";
  if (/\[WARN\]|warn|Warning/.test(line)) return "#d29922";
  if (/\[INFO\]|info/.test(line)) return "#8b949e";
  if (/\[DEBUG\]|debug/.test(line)) return "#484f58";
  if (/✓|success|done|complete/.test(line)) return "#3fb950";
  return "#c9d1d9";
}

function statusColor(status: string): string {
  switch (status) {
    case 'running': return '#58a6ff';
    case 'done': return '#3fb950';
    case 'failed': return '#f85149';
    case 'stuck': return '#d29922';
    default: return '#c9d1d9';
  }
}

function formatMs(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

interface DashboardProps {
  statusReport: StatusReport;
  stateReport: StateReport;
}

function DashboardView(props: DashboardProps): JSX.Element {
  const now = Date.now();

  return (
    <scrollbox flexGrow={1}>
      <box flexDirection="column" padding={1}>
        <text content="Runs" bold fg="#58a6ff" />
        <text content="" />

        <Show
          when={props.statusReport.runs.length > 0}
          fallback={<text fg="#484f58" content="  (no runs)" />}
        >
          <For each={props.statusReport.runs}>
            {(r) => {
              const end = r.finishedAt ? new Date(r.finishedAt).getTime() : now;
              const dur = formatMs(end - new Date(r.startedAt).getTime());
              const id = r.runId.length > 20 ? r.runId.slice(0, 17) + '...' : r.runId;
              return (
                <text
                  content={`  ${id}  ${r.agent.padEnd(12)}  ${r.status.padEnd(8)}  ${dur.padEnd(10)}  ${r.logFile}`}
                  fg={statusColor(r.status)}
                />
              );
            }}
          </For>
        </Show>

        <text content="" />
        <text content="State" bold fg="#58a6ff" />
        <text content="" />

        <Show
          when={props.stateReport.scheduler.length > 0}
          fallback={<text fg="#484f58" content="  Scheduler: (none)" />}
        >
          <text fg="#c9d1d9" content="  Scheduler:" />
          <For each={props.stateReport.scheduler}>
            {(e) => (
              <text
                fg="#8b949e"
                content={`    ${e.key} → index ${e.index}${e.agentName ? ` (${e.agentName})` : ''}`}
              />
            )}
          </For>
        </Show>

        <text content="" />
        <text
          fg="#8b949e"
          content={props.stateReport.maxEntries !== undefined
            ? `  Config: max runs: ${props.stateReport.maxEntries}`
            : '  Config: (none)'}
        />
      </box>
    </scrollbox>
  );
}

function logTitle(): string {
  const session = selectedSession();
  const file = currentLogFile();
  const filePart = file ? file.split("/").pop()!.slice(0, 30) : "";
  if (session?.runId && filePart) {
    return "Log — " + session.runId + " — " + filePart;
  }
  if (session?.runId) {
    return "Log — " + session.runId;
  }
  if (filePart) {
    return "Log — " + filePart;
  }
  return "Log";
}

interface LogViewerProps {
  focused: boolean;
  focusZone: 2 | 3;
}

export function LogViewer(props: LogViewerProps): JSX.Element {
  const visibleLinesWithIndex = createMemo(() => {
    const all = logLines();
    const filtered = filteredLines();
    const slice = filtered.slice(scrollOffset(), scrollOffset() + VISIBLE_LINES);
    const result: [number, string][] = [];
    let allIdx = 0;
    for (const line of slice) {
      while (allIdx < all.length && all[allIdx] !== line) {
        allIdx++;
      }
      result.push([allIdx + 1, line]);
      allIdx++;
    }
    return result;
  });

  createEffect(() => {
    const session = selectedSession();
    if (session?.status === 'running' && filteredLines().length > 0) {
      goToTail();
    }
  });

  return (
    <box
      title={showDashboard() ? "Dashboard — Status" : logTitle()}
      border
      borderStyle="single"
      borderColor={props.focused ? (props.focusZone === 3 ? "#00ddff" : "#00aaff") : "#555555"}
      focused={props.focused}
      flexDirection="column"
      flexGrow={3}
      padding={1}
    >
      <Show
        when={!showDashboard()}
        fallback={
          <DashboardView
            statusReport={buildStatusReport(sessions())}
            stateReport={buildStateReport(resolveStateDir())}
          />
        }
      >
        <box flexDirection="row" gap={2} height={3}>
          <box
            flexDirection="column"
            flexGrow={1}
            marginBottom={1}>

            <input
              value={logFilter()}
              placeholder={props.focusZone === 3 ? "🔍 Filter logs..." : "Filter logs..."}
              focused={props.focusZone === 3}
              onInput={(v) => setLogFilter(v)}
              flexGrow={1}
              width="100%"
              {...{ borderStyle: "single", borderColor: props.focusZone === 3 ? "#58a6ff" : "#30363d" } as any}
            />

            <text content="────────────────────────────────────────" fg="#30363d" />
          </box>
        </box>

        <Show
          when={!showPrompt()}
          fallback={
            <scrollbox flexGrow={1} focused={props.focusZone === 2}>
              <text content={selectedSession()?.prompt ?? "(no prompt)"} fg="#c9d1d9" />
            </scrollbox>
          }
        >
          <scrollbox flexGrow={1} focused={props.focusZone === 2}>
            <Show
              when={filteredLines().length > 0}
              fallback={<text fg="#484f58" content="(no log output)" />}
            >
              <For each={visibleLinesWithIndex()}>
                {([idx, line]) => (
                  <text content={String(idx).padStart(4, " ") + " | " + line} fg={lineColor(line)} />
                )}
              </For>
            </Show>
          </scrollbox>
        </Show>

        <box flexDirection="row" gap={2} marginTop={1}>
          <text content={selectedSession()?.logFile ?? ""} fg="#484f58" />
          <text
            content={showPrompt() ? "[Show Logs]" : "[Show Prompt]"}
            fg="#58a6ff"
            onMouseDown={() => setShowPrompt((p) => !p)}
          />
          <text content={isLoading() ? "\u{26AA}" : "\u{26AB}"} />
        </box>
      </Show>
    </box>
  );
}
