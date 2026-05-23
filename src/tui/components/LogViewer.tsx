/** @jsxImportSource @opentui/solid */
import { For, Show, createMemo } from "solid-js";
import { filteredLines, logFilter, setLogFilter, scrollOffset, autoRefresh, setAutoRefresh, currentLogFile, goToHead, goToTail } from "../store/log";

function lineColor(line: string): string {
  if (/\[ERROR\]|\[FAIL\]/.test(line)) return "#ff4444";
  if (/\[WARN\]/.test(line)) return "#ffaa00";
  if (/\[INFO\]/.test(line)) return "#aaaaaa";
  if (/\[DEBUG\]/.test(line)) return "#666666";
  return "#cccccc";
}

function logTitle(): string {
  const file = currentLogFile();
  return file ? "Log — " + file.split("/").pop()!.slice(0, 30) : "Log";
}

interface LogViewerProps {
  focused: boolean;
  focusZone: 2 | 3;
}

export function LogViewer(props: LogViewerProps): JSX.Element {
  const visibleLines = createMemo(() =>
    filteredLines().slice(scrollOffset(), scrollOffset() + 40)
  );

  return (
    <box
      title={logTitle()}
      border
      borderStyle="single"
      borderColor="#555555"
      focusedBorderColor="#00aaff"
      focused={props.focused}
      flexDirection="column"
      flexGrow={3}
      padding={1}
    >
      {/* Row 1 — toolbar */}
      <box flexDirection="row" gap={2}>
        <input
          value={logFilter()}
          placeholder="filter logs..."
          focused={props.focusZone === 3}
          onInput={(v) => setLogFilter(v)}
          flexGrow={1}
        />
        <text fg="#555555" content="[↑head]" onMouseDown={goToHead} />
        <text fg="#555555" content="[↓tail]" onMouseDown={goToTail} />
        <text
          fg={autoRefresh() ? "#00ff88" : "#555555"}
          content={autoRefresh() ? "[⟳ auto]" : "[⟳ off]"}
          onMouseDown={() => setAutoRefresh(!autoRefresh())}
        />
      </box>

      {/* Row 2 — log lines */}
      <scrollbox flexGrow={1} focused={props.focusZone === 2}>
        <Show
          when={filteredLines().length > 0}
          fallback={<text fg="#555555" content="(no log output)" />}
        >
          <For each={visibleLines()}>
            {(line) => <text content={line} fg={lineColor(line)} />}
          </For>
        </Show>
      </scrollbox>
    </box>
  );
}
