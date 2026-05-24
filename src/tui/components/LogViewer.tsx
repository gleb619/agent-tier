import { For, Show, createMemo, createEffect } from "solid-js";
import type { JSX } from "solid-js";
import { filteredLines, logFilter, setLogFilter, scrollOffset, currentLogFile, goToHead, goToTail, VISIBLE_LINES, isLoading, logLines, showPrompt, setShowPrompt } from "../store/log";
import { selectedSession, showDashboard, sessions } from "../store/sessions";
import { formatStatusTable } from "../../status";

export function lineColor(line: string): string {
  if (/\[ERROR\]|\[FAIL\]|error|Error/.test(line)) return "#f85149";
  if (/\[WARN\]|warn|Warning/.test(line)) return "#d29922";
  if (/\[INFO\]|info/.test(line)) return "#8b949e";
  if (/\[DEBUG\]|debug/.test(line)) return "#484f58";
  if (/✓|success|done|complete/.test(line)) return "#3fb950";
  return "#c9d1d9";
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
          <scrollbox flexGrow={1} focused={props.focusZone === 2}>
            <text content={formatStatusTable(sessions())} fg="#c9d1d9" />
          </scrollbox>
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
