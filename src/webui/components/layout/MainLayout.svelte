<script lang="ts">
import { onMount } from "svelte";
import { get } from "svelte/store";
import Toasts from "$components/common/Toasts.svelte";
import DashboardView from "$components/dashboard/DashboardView.svelte";
import NewTaskView from "$components/newtask/NewTaskView.svelte";
import RunDetailsView from "$components/run/RunDetailsView.svelte";
import SettingsView from "$components/settings/SettingsView.svelte";
import { refreshDashboard } from "$stores/dashboard";
import { runs, selectedRun, selectedRunId, selectRun, setRuns } from "$stores/runs";
import { startGlobalEvents } from "$stores/sse";
import { showToast } from "$stores/toast";
import { currentView, setCurrentView } from "$stores/ui";
import type { ViewType } from "$types/index";
import { handleKeydown, type KeyboardHandlers, neighborRunId } from "$utils/keyboard";
import { deleteRun, listRuns, retryRun } from "../../api/runs";
import Header from "./Header.svelte";
import Sidebar from "./Sidebar.svelte";

const views: { id: ViewType; heading: string; hint: string }[] = [
  { id: "dashboard", heading: "Dashboard", hint: "Run overview." },
  { id: "new-task", heading: "New Task", hint: "Prompt composer." },
  { id: "run-details", heading: "Run Details", hint: "Run meta, live log viewer, actions, discuss." },
  { id: "settings", heading: "Settings", hint: "Defaults persisted to the backend." },
];

function errText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

async function retrySelected(): Promise<void> {
  const run = get(selectedRun);
  if (!run) return;
  try {
    await retryRun(run.runId);
    showToast("Retry started", "success");
  } catch (err) {
    showToast(errText(err), "error");
  }
}

async function killSelected(): Promise<void> {
  const run = get(selectedRun);
  if (!run) return;
  if (!window.confirm(`Kill run ${run.runId}?`)) return;
  try {
    await deleteRun(run.runId);
    showToast("Run killed", "success");
  } catch (err) {
    showToast(errText(err), "error");
  }
}

async function refreshData(): Promise<void> {
  try {
    setRuns(await listRuns());
  } catch (err) {
    showToast(errText(err), "error");
  }
  void refreshDashboard().catch(() => {});
}

const handlers: KeyboardHandlers = {
  navigateTo: setCurrentView,
  selectNextRun: () => selectRun(neighborRunId($runs, $selectedRunId, 1)),
  selectPreviousRun: () => selectRun(neighborRunId($runs, $selectedRunId, -1)),
  openSelectedRun: () => {
    if ($selectedRunId) setCurrentView("run-details");
  },
  retrySelectedRun: () => void retrySelected(),
  killSelectedRun: () => void killSelected(),
  showPrompt: () => window.dispatchEvent(new CustomEvent("at:run-prompt")),
  focusFilter: () => document.querySelector<HTMLInputElement>("#run-filter")?.focus(),
  clearFocus: () => selectRun(null),
  refreshData: () => void refreshData(),
};

function onKeydown(event: KeyboardEvent): void {
  handleKeydown(event, handlers);
}

$: activeView = $currentView;

// Initial load: the run list + dashboard start empty until the first fetch.
// The global event stream keeps them live: runs started elsewhere (CLI, API)
// land in the store via the refetch hook, status changes fold in directly.
onMount(() => {
  void refreshData();
  const events = startGlobalEvents(() => void refreshData());
  events.connect();
  return () => events.close();
});
</script>

<svelte:window on:keydown={onKeydown} />

<a
  href="#main"
  class="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded-md focus:bg-white focus:px-3 focus:py-2 focus:text-sm focus:font-medium focus:text-primary-700 focus:ring-2 focus:ring-primary-500"
>
  Skip to content
</a>

<div class="flex min-h-screen flex-col bg-gray-50 font-sans text-gray-900">
  <Header />
  <div class="flex flex-1">
    <Sidebar />
    <main id="main" tabindex="-1" class="flex-1 p-6 focus:outline-none">
      {#if activeView === "dashboard"}
        <h2 class="mb-4 text-lg font-semibold text-gray-900">Dashboard</h2>
        <DashboardView />
      {:else if activeView === "new-task"}
        <h2 class="mb-4 text-lg font-semibold text-gray-900">New Task</h2>
        <NewTaskView />
      {:else if activeView === "run-details"}
        <h2 class="mb-4 text-lg font-semibold text-gray-900">Run Details</h2>
        <RunDetailsView />
      {:else if activeView === "settings"}
        <h2 class="mb-4 text-lg font-semibold text-gray-900">Settings</h2>
        <SettingsView />
      {/if}
    </main>
  </div>
  <Toasts />
</div>
