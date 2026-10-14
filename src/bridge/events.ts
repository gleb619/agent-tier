import { readAllEvents, readEventsSince } from "../notify/store";
import type { NotifyEvent } from "../notify/types";
import type { BridgeResource } from "./types";

function asNumber(value: unknown, fallback: number): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return fallback;
}

function sortEvents(events: NotifyEvent[]): NotifyEvent[] {
  return events.sort((a, b) => {
    const ta = a.ts ? new Date(a.ts).getTime() : 0;
    const tb = b.ts ? new Date(b.ts).getTime() : 0;
    if (ta !== tb) return ta - tb;
    return (a.seq ?? 0) - (b.seq ?? 0);
  });
}

/** `bridge events tail [runId]` — one-shot snapshot of stored notify events. */
export const eventsResource: BridgeResource = {
  tail: (params, ctx) => {
    const runId =
      typeof params.runId === "string" ? params.runId : typeof params.id === "string" ? params.id : undefined;
    const since = asNumber(params.since, 0);
    const limit = asNumber(params.limit, Number.POSITIVE_INFINITY);

    const events: NotifyEvent[] = runId
      ? ctx.stateDirs.flatMap((d) => readEventsSince(d, runId, since))
      : ctx.stateDirs.flatMap((d) => readAllEvents(d).filter((e) => (e.seq ?? 0) > since));

    const sorted = sortEvents(events);
    return Number.isFinite(limit) ? sorted.slice(0, limit) : sorted;
  },
};
