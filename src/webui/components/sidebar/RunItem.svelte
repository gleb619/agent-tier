<script lang="ts">
import { AlertTriangle, CheckCircle2, Circle, Loader2, XCircle } from "lucide-svelte";
import clsx from "clsx";
import type { ApiRun } from "$types/api";
import { formatDuration, runDurationSeconds } from "$utils/formatters";

export let run: ApiRun;
export let selected = false;
export let onSelect: (() => void) | undefined = undefined;

const TIER_COLORS: Record<number, string> = {
  1: "bg-purple-100 text-purple-700",
  2: "bg-primary-100 text-primary-700",
  3: "bg-yellow-100 text-yellow-700",
  4: "bg-gray-100 text-gray-700",
};

const STATUS_ICON: Record<ApiRun["status"], typeof Circle> = {
  running: Loader2,
  done: CheckCircle2,
  failed: XCircle,
  stuck: AlertTriangle,
};

const STATUS_CLASS: Record<ApiRun["status"], string> = {
  running: "animate-spin text-blue-500",
  done: "text-success-dark",
  failed: "text-error-dark",
  stuck: "text-yellow-600",
};

$: Icon = STATUS_ICON[run.status] ?? Circle;
$: iconClass = STATUS_CLASS[run.status] ?? "text-gray-400";
$: duration = formatDuration(runDurationSeconds(run));
</script>

<button
  type="button"
  data-testid="run-item"
  aria-pressed={selected}
  on:click={() => onSelect?.()}
  title="{run.name} — {run.agent} (T{run.tier})"
  class={clsx(
    "flex w-full items-center gap-2 rounded-md border px-2 py-1.5 text-left text-sm",
    "focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500",
    selected ? "border-primary-500 bg-primary-50" : "border-transparent hover:bg-gray-100",
  )}
>
  <svelte:component this={Icon} class={clsx("h-4 w-4 shrink-0", iconClass)} aria-hidden="true" />
  <span class="min-w-0 flex-1 truncate font-medium text-gray-900">{run.name}</span>
  <span class="shrink-0 rounded bg-gray-100 px-1.5 py-0.5 font-mono text-xs text-gray-700">{run.agent}</span>
  <span class={clsx("shrink-0 rounded px-1.5 py-0.5 text-xs font-semibold", TIER_COLORS[run.tier] ?? TIER_COLORS[4])}>
    T{run.tier}
  </span>
  <span class="shrink-0 text-xs tabular-nums text-gray-500">{duration}</span>
</button>
