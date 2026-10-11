import type { JSX } from "solid-js";
import { createEffect, createMemo, For, Show } from "solid-js";
import type { RunRecord } from "../../run-store";
import { lineColor, statusColor, truncate } from "../format";
import { goToTail, isLoading, logLines, scrollOffset, VISIBLE_LINES } from "../store/log";
import { sessions } from "../store/sessions";
import { setShowPromptOverlay } from "../store/ui";
import { RunMeta } from "./RunMeta";

export interface RunDetailsProps {
  /** Run to render; null when nothing is selected. */
  runId: string | null;
  /** Log pane owns the keyboard (j/k scroll instead of run navigation). */
  focused: boolean;
  /** Show the submitted prompt above the log (design doc §11.2). */
  showPrompt: boolean;
}

export function RunDetails(props: RunDetailsProps): JSX.Element {
  const session = createMemo((): RunRecord | null =>
    props.runId ? (sessions().find((s) => s.runId === props.runId) ?? null) : null,
  );

  const visible = createMemo((): [number, string][] => {
    const from = scrollOffset();
    return logLines()
      .slice(from, from + VISIBLE_LINES)
      .map((line, i) => [from + i + 1, line]);
  });

  // Running sessions stay pinned to the newest output.
  createEffect(() => {
    if (session()?.status === "running" && logLines().length > 0) {
      goToTail();
    }
  });

  return (
    <box
      title={session() ? `Run — ${truncate(session()!.runId, 24)}` : "Run Details"}
      border
      borderStyle="single"
      borderColor={props.focused ? "#00aaff" : "#555555"}
      focused={props.focused}
      flexDirection="column"
      flexGrow={1}
      padding={1}
    >
      <Show
        when={session()}
        fallback={
          <text fg="#484f58" content="  (no run selected — j/k in the sidebar picks one, Enter opens Run Details)" />
        }
      >
        <box border borderStyle="rounded" borderColor="#30363d" padding={1} marginBottom={1}>
          <RunMeta session={session()!} />
        </box>

        <Show when={props.showPrompt}>
          <box flexDirection="column" border borderStyle="rounded" borderColor="#30363d" paddingX={1} maxHeight={10}>
            <text fg="#58a6ff">
              <b>Submitted prompt</b>
            </text>
            <scrollbox flexGrow={1}>
              <text content={session()?.prompt ?? "(no prompt)"} fg="#c9d1d9" />
            </scrollbox>
          </box>
        </Show>

        <scrollbox flexGrow={1}>
          <Show when={logLines().length > 0} fallback={<text fg="#484f58" content="(no log output yet)" />}>
            <For each={visible()}>
              {([idx, line]) => <text content={`${String(idx).padStart(4, " ")} | ${line}`} fg={lineColor(line)} />}
            </For>
          </Show>
        </scrollbox>

        <box flexDirection="row" gap={2} paddingTop={1}>
          <text content={session()?.logFile ?? ""} fg="#484f58" />
          <text
            content={props.showPrompt ? "[hide prompt]" : "[show prompt]"}
            fg="#58a6ff"
            onMouseDown={() => setShowPromptOverlay((v) => !v)}
          />
          <text content={isLoading() ? "◯" : "●"} fg={statusColor(session()?.status ?? "done")} />
        </box>
      </Show>
    </box>
  );
}
