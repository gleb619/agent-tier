/** @jsxImportSource @opentui/solid */

import { createSignal, createEffect, onMount, onCleanup } from "solid-js";
import { useKeyHandler } from "@opentui/solid";
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
  useKeyHandler((key: string | { key: string }) => {
    const k = typeof key === "string" ? key : key.key ?? "";

    if (k === "C-]" || k === "C-[") {
      // Panel navigation: C-] = next, C-[ = previous
      const dir = k === "C-]" ? 1 : -1;
      setFocusZone(z => ((z + dir + FOCUS_COUNT) % FOCUS_COUNT) as any);
    } else if (k === "S-Tab" || k === "S-]") {
      setFocusZone(z => ((z - 1 + FOCUS_COUNT) % FOCUS_COUNT) as any);
    } else if (k === "C-t") {
      cycleTier();
    } else if (k === "C-a") {
      cycleAgent();
    } else if (k === "C-m") {
      cycleMode();
    } else if (k === "C-n") {
      cycleRetries();
    } else if (k === "C-k") {
      const runId = selectedRunId();
      if (runId !== null) {
        killSession(runId);
      }
    } else if (k === "C-e") {
      const runId = selectedRunId();
      if (runId !== null) {
        retrySession(runId);
      }
    } else if (k === "C-f") {
      refreshSessions();
      refreshLog();
    } else if (k === "C-d") {
      toggleDashboard();
    } else if (k === "C-l") {
      setAutoRefresh(!autoRefresh());
    } else if ((k === "ArrowUp" || k === "up") && (focusZone() === 0 || focusZone() === 1)) {
      const sessions = filteredSessions();
      const current = selectedRunId();
      const idx = sessions.findIndex(s => s.runId === current);
      if (idx > 0) {
        setSelectedRunId(sessions[idx - 1].runId);
      } else if (sessions.length > 0 && current === null) {
        setSelectedRunId(sessions[sessions.length - 1].runId);
      }
    } else if ((k === "ArrowDown" || k === "down") && (focusZone() === 0 || focusZone() === 1)) {
      const sessions = filteredSessions();
      const current = selectedRunId();
      const idx = sessions.findIndex(s => s.runId === current);
      if (idx < sessions.length - 1) {
        setSelectedRunId(sessions[idx + 1].runId);
      } else if (sessions.length > 0 && current === null) {
        setSelectedRunId(sessions[0].runId);
      }
    } else if ((k === "ArrowUp" || k === "up") && focusZone() === 2) {
      setScrollOffset(Math.max(0, scrollOffset() - 1));
    } else if ((k === "ArrowDown" || k === "down") && focusZone() === 2) {
      setScrollOffset(Math.min(filteredLines().length - 1, scrollOffset() + 1));
    } else if (k === "g" && focusZone() === 2) {
      goToHead();
    } else if (k === "G" && focusZone() === 2) {
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
        <Sidebar focused={focusZone() <= 1} focusZone={Math.min(focusZone(), 1) as 0|1} />
        <LogViewer focused={focusZone() >= 2 && focusZone() <= 3} focusZone={focusZone() >= 2 && focusZone() <= 3 ? (focusZone() as 2|3) : 2} />
      </box>

      {/* prompt bar */}
      <box flexDirection="column" flexGrow={0}>
        <PromptBar focused={focusZone() === 4} onSubmit={handleSubmit} />
        <HotkeyBar focusZone={focusZone() as 0|1|2|3|4} />
      </box>
    </box>
  );
}
