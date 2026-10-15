<script lang="ts">
import Card from "$components/common/Card.svelte";
import Toggle from "$components/common/Toggle.svelte";
import TierBadge from "$components/run/TierBadge.svelte";
import type { ApiAgent } from "$types/api";
import { isAgentEnabled } from "$utils/agents";

export let agents: ApiAgent[];

/** The dashboard panel is read-only by design: enabling/disabling an agent
 *  writes state (`PUT /api/agents/:name/enable|disable`), so that lives in the
 *  Agents view where the whole effect is visible. */
const TOGGLE_TITLE = "Enable or disable agents in the Agents view";

function byTierThenName(a: ApiAgent, b: ApiAgent): number {
  return a.tier - b.tier || a.name.localeCompare(b.name);
}

$: rows = agents.slice().sort(byTierThenName);
</script>

<Card title="Agents">
  {#if rows.length === 0}
    <p class="text-sm text-gray-500" data-testid="agents-empty">No agents found</p>
  {:else}
    <ul class="divide-y divide-gray-100">
      {#each rows as agent (agent.name)}
        <li class="flex items-center gap-3 py-2" data-testid="agent-{agent.name}">
          <span class="min-w-0 flex-1 truncate text-sm font-medium text-gray-900">{agent.name}</span>
          <TierBadge tier={agent.tier} />
          <span
            class="w-16 shrink-0 text-right text-xs tabular-nums {agent.failures > 0
              ? 'font-semibold text-error-dark'
              : 'text-gray-500'}"
            title="consecutive failures"
          >
            {agent.failures > 0 ? `${agent.failures} fails` : "ok"}
          </span>
          <span class="shrink-0" title={TOGGLE_TITLE}>
            <Toggle label={agent.name} checked={isAgentEnabled(agent)} disabled={true} />
          </span>
        </li>
      {/each}
    </ul>
  {/if}
</Card>
