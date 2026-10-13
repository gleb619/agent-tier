<script lang="ts">
import { Download } from "lucide-svelte";
import { pwaInstall } from "$stores/pwa";
import Button from "./Button.svelte";

export let variant: "primary" | "secondary" | "ghost" = "secondary";
export let size: "sm" | "md" = "sm";
export let showLabelWhenReady = true;

async function handleInstall() {
  await pwaInstall.install();
}
</script>

{#if $pwaInstall.canInstall}
  <Button
    label={showLabelWhenReady ? "Install app" : "Install"}
    {variant}
    {size}
    onClick={handleInstall}
  >
    <span slot="icon" class="mr-1.5">
      <Download size={size === "sm" ? 14 : 16} aria-hidden="true" />
    </span>
  </Button>
{/if}
