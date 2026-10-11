<script lang="ts">
import type { ViewType } from "$types/index";

// Placeholder nav until T7 (layout + nav); mirrors the TUI views.
const views: { id: ViewType; label: string }[] = [
  { id: "dashboard", label: "Dashboard" },
  { id: "new-task", label: "New Task" },
  { id: "run-details", label: "Run Details" },
  { id: "settings", label: "Settings" },
];
</script>

<div class="min-h-screen bg-gray-50 font-sans text-gray-900">
  <header class="border-b border-gray-200 bg-white px-6 py-4">
    <h1 class="text-lg font-semibold text-primary-700">at — WebUI</h1>
  </header>
  <nav class="flex gap-2 border-b border-gray-200 bg-white px-6 py-2">
    {#each views as view}
      <span
        class="rounded-md px-3 py-1 text-sm text-gray-600 hover:bg-primary-50 hover:text-primary-700"
        data-view={view.id}
      >
        {view.label}
      </span>
    {/each}
  </nav>
  <main class="p-6">
    <p class="text-sm text-gray-500">Scaffold ready — views land in T7+.</p>
  </main>
</div>
