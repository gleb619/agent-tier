<script lang="ts">
import type { RunStatus } from "$types/run";
import Badge from "$components/common/Badge.svelte";

export let status: RunStatus;

const colors: Record<RunStatus, "gray" | "blue" | "green" | "red" | "yellow"> = {
  pending: "gray",
  running: "blue",
  done: "green",
  failed: "red",
  killed: "yellow",
};
</script>

<Badge color={colors[status]} text={status} />
