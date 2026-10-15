<script lang="ts">
import clsx from "clsx";
import { tierHue } from "$utils/tiers";

export let tier: number;
</script>

<span class={clsx("inline-flex rounded px-1.5 py-0.5 text-xs font-semibold", tierHue(tier).badge)}>T{tier}</span>
