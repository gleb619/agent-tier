<script lang="ts">
import { onDestroy, onMount } from "svelte";
import { refreshUsage, usage } from "$stores/usage";
import type { ApiRun } from "$types/api";
import { formatDuration, runDurationSeconds } from "$utils/formatters";
import { BUDGET_CLASS, runUsageLines } from "$utils/usage";
import AgentBadge from "./AgentBadge.svelte";
import StatusBadge from "./StatusBadge.svelte";
import TierBadge from "./TierBadge.svelte";

export let run: ApiRun;

let now = Date.now();
let timer: ReturnType<typeof setInterval> | null = null;

onMount(() => {
  void refreshUsage();
  timer = setInterval(() => (now = Date.now()), 1000);
});
onDestroy(() => {
  if (timer) clearInterval(timer);
});

$: duration = formatDuration(runDurationSeconds(run, new Date(now)));

$: budget = run.taskId ? ($usage?.budgets.find((b) => b.taskId === run.taskId) ?? null) : null;
// Same rows as the TUI; nothing shown for legacy runs that were never metered.
$: usageLines = run.usage || budget ? runUsageLines(run, budget) : [];

function fmt(iso: string | null): string {
  return iso ? new Date(iso).toLocaleString() : "—";
}
</script>

<div data-testid="run-meta">
  <div class="flex flex-wrap items-center gap-2">
    <h3 class="text-base font-semibold text-gray-900">{run.name}</h3>
    <StatusBadge status={run.status} />
    <AgentBadge name={run.agent} />
    <TierBadge tier={run.tier} />
  </div>
  <p class="mt-1 break-all font-mono text-xs text-gray-500">{run.runId}</p>
  <dl class="mt-3 grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-3">
    <div>
      <dt class="text-xs text-gray-500">PID</dt>
      <dd class="font-mono tabular-nums">{run.pid ?? "—"}</dd>
    </div>
    <div>
      <dt class="text-xs text-gray-500">Exit code</dt>
      <dd class="font-mono tabular-nums">{run.exitCode ?? "—"}</dd>
    </div>
    <div>
      <dt class="text-xs text-gray-500">Duration</dt>
      <dd class="tabular-nums">{duration}</dd>
    </div>
    <div>
      <dt class="text-xs text-gray-500">Started</dt>
      <dd>{fmt(run.startedAt)}</dd>
    </div>
    <div>
      <dt class="text-xs text-gray-500">Finished</dt>
      <dd>{fmt(run.finishedAt)}</dd>
    </div>
    {#each usageLines as line (line.label)}
      <div data-testid="run-usage-row">
        <dt class="text-xs text-gray-500">{line.label}</dt>
        <dd class={`tabular-nums ${BUDGET_CLASS[line.state]}`}>{line.value}</dd>
      </div>
    {/each}
  </dl>
</div>
