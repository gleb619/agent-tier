<script lang="ts">
import clsx from "clsx";
import { Activity, LayoutDashboard, PlusSquare, Settings } from "lucide-svelte";
import Tooltip from "$components/common/Tooltip.svelte";
import { visibleNavItems } from "$stores/filters";
import { currentView, setCurrentView, sidebarOpen } from "$stores/ui";
import type { ViewType } from "$types/index";
import { prefetchView } from "$utils/prefetch";

/** WebUI-only presentation: id/label come from `ui-spec.ts` (via `visibleNavItems`);
 *  icon and key string live here. The filter, when non-empty, hides rows whose label
 *  + keywords miss every token (docs/layout.md §1.1). The number-key shortcuts
 *  themselves always fire — that's enforced by `handleKeydown`, not by this list. */
const presentation: { id: ViewType; shortcut: string; icon: typeof LayoutDashboard }[] = [
  { id: "dashboard", shortcut: "1", icon: LayoutDashboard },
  { id: "new-task", shortcut: "2", icon: PlusSquare },
  { id: "run-details", shortcut: "3", icon: Activity },
  { id: "settings", shortcut: "4", icon: Settings },
];

$: visible = presentation.filter((p) => $visibleNavItems.some((v) => v.id === p.id));
</script>

<nav aria-label="Main navigation" class="flex flex-col gap-1 p-2">
  {#each visible as item (item.id)}
    {@const active = $currentView === item.id}
    {@const Icon = item.icon}
    {@const label = item.id === "dashboard" ? "Dashboard" : item.id === "new-task" ? "New Task" : item.id === "run-details" ? "Run Details" : "Settings"}
    <Tooltip text={`${label} [${item.shortcut}]`}>
      <button
        type="button"
        aria-current={active ? "page" : undefined}
        class={clsx(
          "flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm",
          "focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500",
          active ? "bg-primary-50 font-medium text-primary-700" : "text-gray-600 hover:bg-gray-100 hover:text-gray-900",
          !$sidebarOpen && "max-md:justify-start md:justify-center md:px-0",
        )}
        on:click={() => setCurrentView(item.id)}
        on:mouseenter={() => prefetchView(item.id)}
        on:focus={() => prefetchView(item.id)}
      >
        <Icon size={16} aria-hidden="true" />
        {#if $sidebarOpen}
          <span class="flex-1 text-left">{label}</span>
          <kbd
            class="rounded border border-gray-200 bg-gray-50 px-1 font-mono text-[10px] text-gray-500"
            aria-hidden="true">{item.shortcut}</kbd
          >
        {/if}
      </button>
    </Tooltip>
  {/each}
</nav>