<script lang="ts">
import clsx from "clsx";
import { AlertTriangle, CheckCircle2, Circle, Loader2, XCircle } from "lucide-svelte";
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

// Fixed column tracks keep status / name / agent / tier / duration aligned
// vertically across the run list (sidebar, Active runs, Recent completions).
const GRID_TEMPLATE = "grid-template-columns: 16px minmax(0,1fr) auto 32px auto;";

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
    "grid w-full items-center gap-2 border-b border-gray-100 px-2 py-1 text-left text-sm last:border-b-0",
    "focus:outline-none focus-visible:bg-gray-100",
    selected ? "bg-primary-50" : "hover:bg-gray-50",
  )}
  style={GRID_TEMPLATE}
>
  <svelte:component
    this={Icon}
    class={clsx("h-4 w-4 shrink-0 justify-self-center", iconClass)}
    aria-hidden="true"
  />
  <span
    data-testid="run-name"
    title={run.name}
    class="min-w-0 truncate text-[13px] font-medium text-gray-900"
  >
    {run.name}
  </span>
  <span
    data-testid="run-agent"
    class="shrink-0 rounded bg-gray-100 px-1.5 py-0.5 font-mono text-[11px] text-gray-700"
  >
    {run.agent}
  </span>
  <span
    data-testid="run-tier"
    class={clsx(
      "shrink-0 rounded px-1 py-px text-center text-[10px] font-semibold leading-tight",
      TIER_COLORS[run.tier] ?? TIER_COLORS[4],
    )}
  >
    T{run.tier}
  </span>
  <span
    data-testid="run-duration"
    class="shrink-0 justify-self-end font-mono text-[11px] tabular-nums text-gray-500"
  >
    {duration}
  </span>
</button>
