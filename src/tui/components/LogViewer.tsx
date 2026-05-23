/** @jsxImportSource @opentui/solid */
import { For, Show, createMemo } from "solid-js";
import { filteredLines, logFilter, setLogFilter, scrollOffset, currentLogFile, goToHead, goToTail, VISIBLE_LINES, isLoading } from "../store/log";

function lineColor(line: string): string {
  if (/\[ERROR\]|\[FAIL\]|error|Error/.test(line)) return "#f85149";
  if (/\[WARN\]|warn|Warning/.test(line)) return "#d29922";
  if (/\[INFO\]|info/.test(line)) return "#8b949e";
  if (/\[DEBUG\]|debug/.test(line)) return "#484f58";
  if (/✓|success|done|complete/.test(line)) return "#3fb950";
  return "#c9d1d9";
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
    filteredLines().slice(scrollOffset(), scrollOffset() + VISIBLE_LINES)
  );

  return (
    <box
      title={logTitle()}
      border
      borderStyle="single"
      borderColor="#21262d"
      focusedBorderColor="#1f6feb"
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
        <Show when={isLoading()}>
          <text content="loading..." fg="#d29922" />
        </Show>
        <text fg="#58a6ff" content="[g] head" onMouseDown={goToHead} />
        <text fg="#58a6ff" content="[G] tail" onMouseDown={goToTail} />
      </box>

      {/* Row 2 — log lines */}
      <scrollbox flexGrow={1} focused={props.focusZone === 2}>
        <Show
          when={filteredLines().length > 0}
          fallback={<text fg="#484f58" content="(no log output)" />}
        >
          <For each={visibleLines()}>
            {(line) => <text content={line} fg={lineColor(line)} />}
          </For>
        </Show>
      </scrollbox>
    </box>
  );
}