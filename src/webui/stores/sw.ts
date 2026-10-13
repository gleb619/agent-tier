import { writable } from "svelte/store";

/** Mirrors the browser's online state as reported by the service worker / window events. */
export const isOnline = writable(true);

/** True when a new service worker is waiting and the page can reload to activate it. */
export const updateAvailable = writable(false);
