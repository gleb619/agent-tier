<script lang="ts">
import clsx from "clsx";
import { Activity, LayoutDashboard, PlusSquare, Settings } from "lucide-svelte";
import { currentView, setCurrentView, sidebarOpen } from "$stores/ui";
import type { ViewType } from "$types/index";
import Tooltip from "$components/common/Tooltip.svelte";

const items: { id: ViewType; label: string; shortcut: string; icon: typeof LayoutDashboard }[] = [
  { id: "dashboard", label: "Dashboard", shortcut: "1", icon: LayoutDashboard },
  { id: "new-task", label: "New Task", shortcut: "2", icon: PlusSquare },
  { id: "run-details", label: "Run Details", shortcut: "3", icon: Activity },
  { id: "settings", label: "Settings", shortcut: "4", icon: Settings },
];
</script>

<nav aria-label="Main navigation" class="flex flex-col gap-1 p-2">
  {#each items as item (item.id)}
    {@const active = $currentView === item.id}
    {@const Icon = item.icon}
    <Tooltip text={`${item.label} [${item.shortcut}]`}>
      <button
        type="button"
        aria-current={active ? "page" : undefined}
        class={clsx(
          "flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm",
          active ? "bg-primary-50 font-medium text-primary-700" : "text-gray-600 hover:bg-gray-100 hover:text-gray-900",
          !$sidebarOpen && "max-md:justify-start md:justify-center md:px-0",
        )}
        on:click={() => setCurrentView(item.id)}
      >
        <Icon size={16} aria-hidden="true" />
        {#if $sidebarOpen}
          <span class="flex-1 text-left">{item.label}</span>
          <kbd
            class="rounded border border-gray-200 bg-gray-50 px-1 font-mono text-[10px] text-gray-400"
            aria-hidden="true">{item.shortcut}</kbd
          >
        {/if}
      </button>
    </Tooltip>
  {/each}
</nav>
