import { TIERS, type Tier } from "../../ui-spec";

export interface TierHue {
  badge: string;
  text: string;
}

/** Tier hue tokens shared by `TierBadge` and the Agents tier group headings
 *  (docs/layout.md §7: 1 purple · 2 blue · 3 amber · 4 gray — WebUI rendering
 *  of the `tier-N` design tokens). */
export const TIER_HUES: Record<Tier, TierHue> = {
  1: { badge: "bg-purple-100 text-purple-700", text: "text-purple-700" },
  2: { badge: "bg-primary-100 text-primary-700", text: "text-primary-700" },
  3: { badge: "bg-yellow-100 text-yellow-700", text: "text-yellow-700" },
  4: { badge: "bg-gray-100 text-gray-700", text: "text-gray-500" },
};

/** Hues for an API tier value; anything outside 1-4 falls back to tier 4. */
export function tierHue(tier: number): TierHue {
  return (TIERS as readonly number[]).includes(tier) ? TIER_HUES[tier as Tier] : TIER_HUES[4];
}
