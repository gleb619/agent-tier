import { writable } from "svelte/store";
import type { ViewType } from "$types/index";

const VIEWS: ViewType[] = ["dashboard", "new-task", "run-details", "settings"];

export const currentView = writable<ViewType>(readPref<ViewType>("webui.currentView", "dashboard", isView));
export const sidebarOpen = writable(readPref("webui.sidebarOpen", true, isBoolean));
export const focusMode = writable(readPref("webui.focusMode", false, isBoolean));

/** Convenience setter (persistence happens in the subscription below). */
export function setCurrentView(view: ViewType): void {
  currentView.set(view);
}

currentView.subscribe((view) => writePref("webui.currentView", view));
sidebarOpen.subscribe((open) => writePref("webui.sidebarOpen", open));
focusMode.subscribe((focus) => writePref("webui.focusMode", focus));

function isView(v: unknown): v is ViewType {
  return typeof v === "string" && (VIEWS as string[]).includes(v);
}

function isBoolean(v: unknown): v is boolean {
  return typeof v === "boolean";
}

function readPref<T>(key: string, fallback: T, check: (v: unknown) => v is T): T {
  try {
    const raw = globalThis.localStorage?.getItem(key);
    if (raw === null) return fallback;
    const parsed: unknown = JSON.parse(raw);
    return check(parsed) ? parsed : fallback;
  } catch {
    return fallback;
  }
}

function writePref(key: string, value: unknown): void {
  try {
    globalThis.localStorage?.setItem(key, JSON.stringify(value));
  } catch {}
}
