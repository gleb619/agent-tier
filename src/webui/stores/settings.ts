import { writable } from "svelte/store";
import { api } from "../api/client";

export interface WebSettings {
  defaultTier: number;
  defaultAgent: string;
  runMode: "stream" | "block" | "detached";
  retries: number;
  autoRefresh: boolean;
  [key: string]: unknown;
}

export const DEFAULT_SETTINGS: WebSettings = {
  defaultTier: 2,
  defaultAgent: "mm-code",
  runMode: "stream",
  retries: 0,
  autoRefresh: true,
};

/** App settings: defaults, overlaid with whatever the backend (`web-settings.json`) stores. */
export const settings = writable<WebSettings>({ ...DEFAULT_SETTINGS });

/** Fetch backend settings and merge them over the defaults. Never throws. */
export async function loadSettings(): Promise<void> {
  try {
    const stored = await api.getSettings();
    settings.set({ ...DEFAULT_SETTINGS, ...stored });
  } catch {}
}

/** Merge `patch` into the store, PUT the whole object to the backend, adopt the response. */
export async function saveSettings(patch: Partial<WebSettings> = {}): Promise<void> {
  let merged: WebSettings = { ...DEFAULT_SETTINGS };
  settings.update((s) => (merged = { ...s, ...patch }));
  try {
    const saved = await api.putSettings(merged);
    settings.set({ ...merged, ...saved });
  } catch (err) {
    settings.set(merged); // keep the optimistic value; caller can surface `err`
    throw err;
  }
}
