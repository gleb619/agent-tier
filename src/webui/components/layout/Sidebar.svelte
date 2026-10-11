<script lang="ts">
import clsx from "clsx";
import { sidebarOpen } from "$stores/ui";
import Navigation from "$components/sidebar/Navigation.svelte";
import RunList from "$components/sidebar/RunList.svelte";
</script>

<!--
  Collapsible sidebar: 280px open / 64px collapsed on desktop, full-width
  overlay on mobile (hidden when closed). Navigation on top, run list fills
  the rest (ideas §4.2: nav menu + run list).
-->
<aside
  class={clsx(
    "flex h-full shrink-0 flex-col border-r border-gray-200 bg-white transition-all duration-200",
    "max-md:fixed max-md:inset-y-0 max-md:left-0 max-md:z-30",
    $sidebarOpen ? "max-md:w-full" : "max-md:hidden",
    $sidebarOpen ? "w-[280px]" : "w-16",
  )}
  aria-label="Sidebar"
  aria-hidden={!$sidebarOpen ? undefined : false}
>
  <div class={clsx("shrink-0 overflow-hidden", !$sidebarOpen && "max-md:hidden")}>
    <Navigation />
  </div>
  {#if $sidebarOpen}
    <div class="min-h-0 flex-1 overflow-hidden px-2 pb-2">
      <RunList />
    </div>
  {/if}
</aside>
