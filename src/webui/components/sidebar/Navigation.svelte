<script lang="ts">
import clsx from "clsx";
import { Activity, Bot, LayoutDashboard, PlusSquare, Settings } from "lucide-svelte";
import Tooltip from "$components/common/Tooltip.svelte";
import { visibleNavItems } from "$stores/filters";
import { currentView, setCurrentView, sidebarOpen } from "$stores/ui";
import type { ViewType } from "$types/index";
import { prefetchView } from "$utils/prefetch";

/** WebUI-only presentation: the icon each view gets. Order, label and number
 *  shortcut come from `NAV_ITEMS` in `src/ui-spec.ts` (docs/layout.md §1). */
const ICONS: Record<ViewType, typeof LayoutDashboard> = {
  dashboard: LayoutDashboard,
  "new-task": PlusSquare,
  "run-details": Activity,
  agents: Bot,
  settings: Settings,
};

/** The filter, when non-empty, hides rows whose label + keywords miss every
 *  token (docs/layout.md §1.1). The number-key shortcuts themselves always
 *  fire — that's enforced by `handleKeydown`, not by this list. */
$: visible = $visibleNavItems.map((item) => ({
  id: item.id,
  label: item.label,
  shortcut: String(item.shortcut),
  icon: ICONS[item.id],
}));
</script>

<nav aria-label="Main navigation" class="flex flex-col gap-1 p-2">
  {#each visible as item (item.id)}
    {@const active = $currentView === item.id}
    {@const Icon = item.icon}
    <Tooltip text={`${item.label} [${item.shortcut}]`}>
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
          <span class="flex-1 text-left">{item.label}</span>
          <kbd
            class="rounded border border-gray-200 bg-gray-50 px-1 font-mono text-[10px] text-gray-500"
            aria-hidden="true">{item.shortcut}</kbd
          >
        {/if}
      </button>
    </Tooltip>
  {/each}
</nav>
