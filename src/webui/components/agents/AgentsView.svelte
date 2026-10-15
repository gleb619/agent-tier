<script lang="ts">
import { onMount } from "svelte";
import Badge from "$components/common/Badge.svelte";
import Card from "$components/common/Card.svelte";
import Input from "$components/common/Input.svelte";
import Select from "$components/common/Select.svelte";
import Toggle from "$components/common/Toggle.svelte";
import TierBadge from "$components/run/TierBadge.svelte";
import { agentRunStats, toggleAgentEnabled } from "$stores/agents";
import { agents, refreshDashboard } from "$stores/dashboard";
import { showToast } from "$stores/toast";
import {
  agentHealth,
  blockedUntilLabel,
  filterAgents,
  formatAgentRunStats,
  groupAgentsByTier,
  isUserEnabled,
} from "$utils/agents";
import { tierHue } from "$utils/tiers";
import { AGENT_HEALTH_CONFIG, type AgentHealthState, TIER_CONFIG, TIERS } from "../../../ui-spec";

/** "All tiers" is the empty tier filter. */
const ALL_TIERS = "0";
let query = "";
let tier: string = ALL_TIERS;
/** Agents with an enable/disable request in flight (their toggle is locked). */
let pending = new Set<string>();

const tierOptions = [
  { value: ALL_TIERS, label: "All tiers" },
  ...TIERS.map((n) => ({ value: String(n), label: TIER_CONFIG[n].label })),
];

/** Health presentation: glyph hue (layout.md §7) + badge color for the label. */
const HEALTH_STYLE: Record<AgentHealthState, { glyph: string; badge: "gray" | "green" | "red" }> = {
  ok: { glyph: "text-success-dark", badge: "green" },
  disabled: { glyph: "text-gray-500", badge: "gray" },
  failing: { glyph: "text-error-dark", badge: "red" },
};

$: groups = groupAgentsByTier(filterAgents($agents, query, Number(tier)));

// The agent list is normally warm from the dashboard; fetch it when the
// Agents view is the first one entered.
onMount(() => {
  if ($agents.length === 0) void refreshDashboard();
});

function errText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

async function toggle(name: string, enabled: boolean): Promise<void> {
  if (pending.has(name)) return;
  pending = new Set(pending).add(name);
  try {
    await toggleAgentEnabled(name, enabled);
    showToast(`${name} ${enabled ? "enabled" : "disabled"}`, "success");
  } catch (err) {
    showToast(`Could not ${enabled ? "enable" : "disable"} ${name}: ${errText(err)}`, "error");
  } finally {
    const next = new Set(pending);
    next.delete(name);
    pending = next;
  }
}
</script>

<div class="flex flex-col gap-4" data-testid="agents-view">
  <div class="flex flex-wrap items-end gap-3" data-testid="agents-filters">
    <div class="w-full sm:w-64">
      <Input id="agents-filter" label="Filter agents" placeholder="agent name…" bind:value={query} />
    </div>
    <div class="w-full sm:w-44">
      <Select id="agents-tier" label="Tier" bind:value={tier} options={tierOptions} />
    </div>
  </div>

  {#if groups.length === 0}
    <Card>
      <p class="text-sm text-gray-500" data-testid="agents-empty">
        {query.trim() === "" && tier === ALL_TIERS ? "No agents found" : "No agents match the filter."}
      </p>
    </Card>
  {:else}
    {#each groups as group (group.tier)}
      <section class="flex flex-col gap-2" data-testid="agents-tier-{group.tier}">
        <h3 class="text-sm font-semibold {tierHue(group.tier).text}">
          {TIER_CONFIG[group.tier].label} — {TIER_CONFIG[group.tier].role}
        </h3>
        <div class="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {#each group.agents as agent (agent.name)}
            {@const health = agentHealth(agent)}
            {@const blocked = blockedUntilLabel(agent.disabledTo)}
            <Card>
              <div class="flex flex-col gap-2" data-testid="agent-{agent.name}">
                <div class="flex items-center gap-2">
                  <span class="min-w-0 flex-1 truncate text-sm font-medium text-gray-900">{agent.name}</span>
                  <TierBadge tier={agent.tier} />
                </div>
                <div class="flex items-center gap-2">
                  <span class="text-sm {HEALTH_STYLE[health].glyph}" aria-hidden="true">
                    {AGENT_HEALTH_CONFIG[health].glyph}
                  </span>
                  <Badge color={HEALTH_STYLE[health].badge} text={health} />
                  {#if blocked}
                    <span class="text-xs text-yellow-700" title="Blocked after repeated failures; clears on its own">
                      {blocked}
                    </span>
                  {/if}
                  <span class="ml-auto text-xs tabular-nums text-gray-500">
                    {formatAgentRunStats($agentRunStats.get(agent.name))}
                  </span>
                </div>
                <div class="border-t border-gray-100 pt-2">
                  <Toggle
                    label="Enabled"
                    checked={isUserEnabled(agent)}
                    disabled={pending.has(agent.name)}
                    on:change={(event) => void toggle(agent.name, event.detail)}
                  />
                </div>
              </div>
            </Card>
          {/each}
        </div>
      </section>
    {/each}
  {/if}
</div>
