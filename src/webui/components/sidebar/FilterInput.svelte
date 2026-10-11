<script lang="ts">
import { agentFilter, searchQuery, statusFilter, type StatusFilter } from "$stores/filters";
import { runs } from "$stores/runs";

const STATUSES: { value: StatusFilter; label: string }[] = [
  { value: "all", label: "All statuses" },
  { value: "running", label: "Running" },
  { value: "done", label: "Done" },
  { value: "failed", label: "Failed" },
  { value: "stuck", label: "Stuck" },
];

$: agents = [...new Set($runs.map((run) => run.agent))].sort();
</script>

<div class="flex flex-col gap-2" data-testid="filter-input">
  <input
    type="search"
    aria-label="Filter runs"
    placeholder="Filter runs…"
    bind:value={$searchQuery}
    class="w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
  />
  <div class="flex gap-2">
    <select
      aria-label="Status"
      bind:value={$statusFilter}
      class="min-w-0 flex-1 rounded-md border border-gray-300 px-2 py-1.5 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
    >
      {#each STATUSES as status}
        <option value={status.value}>{status.label}</option>
      {/each}
    </select>
    <select
      aria-label="Agent"
      bind:value={$agentFilter}
      class="min-w-0 flex-1 rounded-md border border-gray-300 px-2 py-1.5 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
    >
      <option value="all">All agents</option>
      {#each agents as agent}
        <option value={agent}>{agent}</option>
      {/each}
    </select>
  </div>
</div>
