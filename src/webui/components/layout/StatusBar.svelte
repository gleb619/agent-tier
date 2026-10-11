<script lang="ts">
import clsx from "clsx";
import { connectionError, sseConnected } from "$stores/sse";
</script>

<div
  class="flex items-center gap-2 text-xs text-gray-500"
  role="status"
  aria-live="polite"
  data-testid="status-bar"
>
  <span
    class={clsx("h-2 w-2 rounded-full", $sseConnected ? "bg-success" : "bg-error")}
    aria-hidden="true"
  ></span>
  {#if $sseConnected}
    <span>Connected</span>
  {:else}
    <span>Disconnected</span>
  {/if}
  {#if !$sseConnected && $connectionError}
    <span class="text-error-dark">{$connectionError}</span>
  {/if}
</div>
