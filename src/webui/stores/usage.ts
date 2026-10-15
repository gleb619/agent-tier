import { writable } from "svelte/store";
import type { ApiUsage } from "$types/api";
import { api } from "../api/client";

/** Latest `GET /api/usage` payload (null until fetched, or when the backend predates it). */
export const usage = writable<ApiUsage | null>(null);

/** Best-effort refresh: usage is advisory, a failure must never surface as a dashboard error. */
export async function refreshUsage(): Promise<void> {
  try {
    usage.set(await api.getUsage());
  } catch {
    // keep the last good snapshot
  }
}
