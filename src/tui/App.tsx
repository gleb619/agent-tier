import { createSignal, createEffect, onMount, onCleanup } from "solid-js";
import { useKeyHandler } from "@opentui/solid";
import { KeyEvent } from "@opentui/core";
import { spawn } from "child_process";
import { Sidebar } from "./components/Sidebar";
import { LogViewer } from "./components/LogViewer";
import { PromptBar, type PromptSubmitOpts } from "./components/PromptBar";
import { HotkeyBar } from "./components/HotkeyBar";
import { filteredSessions, selectedRunId, setSelectedRunId, refreshSessions, killSession, retrySession, toggleDashboard } from "./store/sessions";
import { scrollOffset, setScrollOffset, filteredLines, autoRefresh, refreshLog, goToHead, goToTail, setAutoRefresh } from "./store/log";
import { cycleTier, cycleAgent, cycleMode, cycleRetries } from "./store/settings";

export function App(): JSX.Element {
  const [focusZone, setFocusZone] = createSignal<0|1|2|3|4>(4);
  const FOCUS_COUNT = 5;

  // Auto-refresh timer
  createEffect(() => {
    if (autoRefresh()) {
      const id = setInterval(() => {
        refreshSessions();
        refreshLog();
      }, 5000);
      onCleanup(() => clearInterval(id));
    }
  });

  // Initial load
  onMount(() => {
    refreshSessions();
  });

  // Keyboard handler
  useKeyHandler((key: KeyEvent) => {
    if (key.eventType !== "press") return;

    const { name, ctrl, shift } = key;

    if (ctrl && (name === "]" || name === "[")) {
      // Panel navigation: C-] = next, C-[ = previous
      const dir = name === "]" ? 1 : -1;
      setFocusZone(z => ((z + dir + FOCUS_COUNT) % FOCUS_COUNT) as any);
    } else if ((shift && name === "tab") || (shift && name === "]")) {
      setFocusZone(z => ((z - 1 + FOCUS_COUNT) % FOCUS_COUNT) as any);
    } else if (ctrl && name === "t") {
      cycleTier();
    } else if (ctrl && name === "a") {
      cycleAgent();
    } else if (ctrl && name === "m") {
      cycleMode();
    } else if (ctrl && name === "n") {
      cycleRetries();
    } else if (ctrl && name === "k") {
      const runId = selectedRunId();
      if (runId !== null) {
        killSession(runId);
      }
    } else if (ctrl && name === "e") {
      const runId = selectedRunId();
      if (runId !== null) {
        retrySession(runId);
      }
    } else if (ctrl && name === "f") {
      refreshSessions();
      refreshLog();
    } else if (ctrl && name === "d") {
      toggleDashboard();
    } else if (ctrl && name === "l") {
      setAutoRefresh(!autoRefresh());
    } else if (name === "up" && (focusZone() === 0 || focusZone() === 1)) {
      const sessions = filteredSessions();
      const current = selectedRunId();
      const idx = sessions.findIndex(s => s.runId === current);
      if (idx > 0) {
        setSelectedRunId(sessions[idx - 1].runId);
      } else if (sessions.length > 0 && current === null) {
        setSelectedRunId(sessions[sessions.length - 1].runId);
      }
    } else if (name === "down" && (focusZone() === 0 || focusZone() === 1)) {
      const sessions = filteredSessions();
      const current = selectedRunId();
      const idx = sessions.findIndex(s => s.runId === current);
      if (idx < sessions.length - 1) {
        setSelectedRunId(sessions[idx + 1].runId);
      } else if (sessions.length > 0 && current === null) {
        setSelectedRunId(sessions[0].runId);
      }
    } else if (name === "up" && focusZone() === 2) {
      setScrollOffset(Math.max(0, scrollOffset() - 1));
    } else if (name === "down" && focusZone() === 2) {
      setScrollOffset(Math.min(filteredLines().length - 1, scrollOffset() + 1));
    } else if (name === "g" && !ctrl && !shift && focusZone() === 2) {
      goToHead();
    } else if (name === "g" && shift && focusZone() === 2) {
      goToTail();
    }
  }, {});

  const handleSubmit = (prompt: string, opts: PromptSubmitOpts): void => {
    const args: string[] = ["-p", prompt, "-t", String(opts.tier)];
    if (opts.agent !== "auto") {
      args.push("-a", opts.agent);
    }
    if (opts.mode === "stream") {
      args.push("-s");
    }
    if (opts.retries > 0) {
      args.push("-r", String(opts.retries));
    }

    spawn("at", args, { detached: false, stdio: "inherit" });
    setTimeout(() => refreshSessions(), 1000);
  };

  return (
    <box width="100%" height="100%" flexDirection="column">
      {/* header */}
      <box flexDirection="row" gap={2} padding={1} paddingY={0}>
        <text content="at — agent tier" fg="#aaaaaa" />
        <text content={autoRefresh() ? "⟳ auto-refresh ON" : "⟳ auto-refresh OFF"} fg={autoRefresh() ? "#00ff88" : "#555555"} />
      </box>

      {/* main area: sidebar + log viewer side by side */}
      <box flexDirection="row" flexGrow={1}>
        <box onMouseDown={() => setFocusZone(0)}><Sidebar focused={focusZone() <= 1} focusZone={Math.min(focusZone(), 1) as 0|1} /></box>
        <box onMouseDown={() => setFocusZone(2)}><LogViewer focused={focusZone() >= 2 && focusZone() <= 3} focusZone={focusZone() >= 2 && focusZone() <= 3 ? (focusZone() as 2|3) : 2} /></box>
      </box>

      {/* prompt bar */}
      <box flexDirection="column" flexGrow={0} onMouseDown={() => setFocusZone(4)}>
        <PromptBar focused={focusZone() === 4} onSubmit={handleSubmit} />
        <HotkeyBar focusZone={focusZone() as 0|1|2|3|4} />
      </box>
    </box>
  );
}
