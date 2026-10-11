<script lang="ts">
import { currentView, setCurrentView } from "$stores/ui";
import type { ViewType } from "$types/index";
import Card from "$components/common/Card.svelte";
import DashboardView from "$components/dashboard/DashboardView.svelte";
import Header from "./Header.svelte";
import Sidebar from "./Sidebar.svelte";

const views: { id: ViewType; heading: string; hint: string }[] = [
  { id: "dashboard", heading: "Dashboard", hint: "Run overview." },
  { id: "new-task", heading: "New Task", hint: "Prompt composer lands in T9." },
  { id: "run-details", heading: "Run Details", hint: "Log viewer lands in T10." },
  { id: "settings", heading: "Settings", hint: "Settings editor lands in T11." },
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
      {:else}
        {#each views.filter((v) => v.id !== "dashboard") as view (view.id)}
          {#if view.id === activeView}
            <Card>
              <h2 class="text-lg font-semibold text-gray-900">{view.heading}</h2>
              <p class="mt-2 text-sm text-gray-500">{view.hint}</p>
            </Card>
          {/if}
        {/each}
      {/if}
    </main>
  </div>
</div>
