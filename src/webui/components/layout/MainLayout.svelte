<script lang="ts">
import { currentView, setCurrentView } from "$stores/ui";
import type { ViewType } from "$types/index";
import Toasts from "$components/common/Toasts.svelte";
import DashboardView from "$components/dashboard/DashboardView.svelte";
import NewTaskView from "$components/newtask/NewTaskView.svelte";
import RunDetailsView from "$components/run/RunDetailsView.svelte";
import SettingsView from "$components/settings/SettingsView.svelte";
import Header from "./Header.svelte";
import Sidebar from "./Sidebar.svelte";

const views: { id: ViewType; heading: string; hint: string }[] = [
  { id: "dashboard", heading: "Dashboard", hint: "Run overview." },
  { id: "new-task", heading: "New Task", hint: "Prompt composer." },
  { id: "run-details", heading: "Run Details", hint: "Run meta, live log viewer, actions, discuss." },
  { id: "settings", heading: "Settings", hint: "Defaults persisted to the backend." },
];

function isFormField(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement
  );
}

function onKeydown(event: KeyboardEvent): void {
  if (isFormField(event.target)) return;
  const index = Number.parseInt(event.key, 10) - 1;
  const view = views[index];
  if (view) setCurrentView(view.id);
}

$: activeView = $currentView;
</script>

<svelte:window on:keydown={onKeydown} />

<div class="flex min-h-screen flex-col bg-gray-50 font-sans text-gray-900">
  <Header />
  <div class="flex flex-1">
    <Sidebar />
    <main class="flex-1 p-6">
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
