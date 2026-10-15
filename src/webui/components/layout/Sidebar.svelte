<script lang="ts">
import clsx from "clsx";
import FilterInput from "$components/sidebar/FilterInput.svelte";
import Navigation from "$components/sidebar/Navigation.svelte";
import RunList from "$components/sidebar/RunList.svelte";
import { sidebarOpen } from "$stores/ui";
</script>

<!--
  Collapsible sidebar: 256px open (`NAV_WIDTH_PX`) / 64px collapsed on desktop,
  full-width overlay on mobile (hidden when closed). Layout, in order:
  Filter (top, hidden when collapsed) → Navigation → Run list.
  The filter narrows both nav and runs (docs/layout.md §1.1).
-->
<aside
  class={clsx(
    "flex h-full shrink-0 flex-col border-r border-gray-200 bg-white transition-all duration-200",
    "max-md:fixed max-md:inset-y-0 max-md:left-0 max-md:z-30",
    $sidebarOpen ? "max-md:w-full" : "max-md:hidden",
    $sidebarOpen ? "w-[256px]" : "w-16",
  )}
  aria-label="Sidebar"
  aria-hidden={!$sidebarOpen ? undefined : false}
>
  {#if $sidebarOpen}
    <div class="shrink-0 overflow-hidden p-2" data-testid="sidebar-filter">
      <FilterInput />
    </div>
  {/if}
  <div class={clsx("shrink-0 overflow-hidden", !$sidebarOpen && "max-md:hidden")}>
    <Navigation />
  </div>
  {#if $sidebarOpen}
    <div class="min-h-0 flex-1 overflow-hidden px-2 pb-2">
      <RunList />
    </div>
  {/if}
</aside>