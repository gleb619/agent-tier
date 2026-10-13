<script lang="ts">
import { PanelLeft } from "lucide-svelte";
import InstallButton from "$components/common/InstallButton.svelte";
import { sidebarOpen } from "$stores/ui";
import StatusBar from "./StatusBar.svelte";
</script>

<header class="flex items-center gap-3 border-b border-gray-200 bg-white px-4 py-3">
  <button
    type="button"
    aria-label="Toggle sidebar"
    aria-expanded={$sidebarOpen}
    class="rounded-md p-1.5 text-gray-500 hover:bg-gray-100 hover:text-gray-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
    on:click={() => sidebarOpen.set(!$sidebarOpen)}
  >
    <PanelLeft size={18} aria-hidden="true" />
  </button>
  <h1 class="text-base font-semibold text-primary-700">at — WebUI</h1>
  <div class="ml-auto flex items-center gap-2">
    <InstallButton variant="secondary" size="sm" />
    <StatusBar />
  </div>
</header>
