import { createSignal, createEffect, onMount, onCleanup } from "solid-js";
import { useKeyHandler } from "@opentui/solid";
import { KeyEvent } from "@opentui/core";
import { spawn } from "child_process";
import { Sidebar } from "./components/Sidebar";
import { LogViewer } from "./components/LogViewer";
import { PromptBar, type PromptSubmitOpts } from "./components/PromptBar";
import { HotkeyBar } from "./components/HotkeyBar";
import { filteredSessions, selectedRunId, setSelectedRunId, refreshSessions, killSession, retrySession, showDashboard, setShowDashboard } from "./store/sessions";
import { scrollOffset, setScrollOffset, filteredLines, autoRefresh, refreshLog, goToHead, goToTail, setAutoRefresh } from "./store/log";
import { cycleTier, cycleAgent, cycleMode, cycleRetries } from "./store/settings";

export function App(): JSX.Element {
  const [focusZone, setFocusZone] = createSignal<0|1|2|3|4>(4);

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

    // Tab: toggle between sidebar zones 0↔1 and log zones 2↔3
    if (name === "tab" && !ctrl && !shift) {
      const z = focusZone();
      if (z === 0) setFocusZone(1);
      else if (z === 1) setFocusZone(0);
      else if (z === 2) setFocusZone(3);
      else if (z === 3) setFocusZone(2);
      // zone 4: no-op
    } else if (ctrl && name === "]") {
      // Panel navigation: C-] = next main zone
      const z = focusZone();
      if (z === 0 || z === 1) setFocusZone(2);
      else if (z === 2 || z === 3) setFocusZone(4);
      else if (z === 4) setFocusZone(1);
    } else if (shift && name === "tab") {
      // Panel navigation: S-Tab = previous main zone
      const z = focusZone();
      if (z === 0 || z === 1) setFocusZone(4);
      else if (z === 2 || z === 3) setFocusZone(1);
      else if (z === 4) setFocusZone(2);
    } else if (ctrl && name === "h" && (focusZone() === 2 || focusZone() === 3)) {
      goToHead();
    } else if (ctrl && name === "t" && (focusZone() === 2 || focusZone() === 3)) {
      goToTail();
    } else if (ctrl && name === "t") {
      cycleTier();
    } else if (ctrl && name === "a") {
      cycleAgent();
    } else if (ctrl && name === "o") {
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
    } else if (ctrl && name === "r") {
      refreshSessions();
      refreshLog();
    } else if (ctrl && name === "l") {
      setAutoRefresh(!autoRefresh());
    //TODO: for sidebar, changing of selection, doesnt update log view
    } else if (name === "up" && (focusZone() === 0 || focusZone() === 1)) {
      const sessions = filteredSessions();
      const current = selectedRunId();
      const idx = sessions.findIndex(s => s.runId === current);
      if (showDashboard()) {
        // no-op, already at top
      } else if (current === null) {
        setShowDashboard(true);
      } else if (idx === 0) {
        setShowDashboard(true);
        setSelectedRunId(null);
      } else if (idx > 0) {
        setSelectedRunId(sessions[idx - 1].runId);
      }
    //TODO: for sidebar, changing of selection, doesnt update log view
    } else if (name === "down" && (focusZone() === 0 || focusZone() === 1)) {
      const sessions = filteredSessions();
      const current = selectedRunId();
      const idx = sessions.findIndex(s => s.runId === current);
      if (showDashboard()) {
        setShowDashboard(false);
        if (sessions.length > 0) {
          setSelectedRunId(sessions[0].runId);
        }
      } else if (current === null) {
        if (sessions.length > 0) {
          setSelectedRunId(sessions[0].runId);
        }
      } else if (idx < sessions.length - 1) {
        setSelectedRunId(sessions[idx + 1].runId);
      }
    } else if (name === "up" && (focusZone() === 2 || focusZone() === 3)) {
      setScrollOffset(Math.max(0, scrollOffset() - 1));
    } else if (name === "down" && (focusZone() === 2 || focusZone() === 3)) {
      setScrollOffset(Math.min(filteredLines().length - 1, scrollOffset() + 1));
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
        <box width="25%" onMouseDown={() => setFocusZone(0)}>
          <Sidebar focused={focusZone() <= 1} focusZone={Math.min(focusZone(), 1) as 0|1} />
        </box>
        <box flexGrow={1} onMouseDown={() => setFocusZone(2)}>
          <LogViewer focused={focusZone() >= 2 && focusZone() <= 3} focusZone={focusZone() >= 2 && focusZone() <= 3 ? (focusZone() as 2|3) : 2} />
        </box>
      </box>

      {/* prompt bar */}
      <box flexDirection="column" flexGrow={0} onMouseDown={() => setFocusZone(4)}>
        <PromptBar focused={focusZone() === 4} onSubmit={handleSubmit} />
        <HotkeyBar focusZone={focusZone() as 0|1|2|3|4} />
      </box>
    </box>
  );
}
