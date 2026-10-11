import { writable } from "svelte/store";
import { SseManager, type SseManagerOptions } from "../api/sse";
import { applySseEvent } from "./runs";

export const sseConnected = writable(false);
export const lastEventTime = writable<Date | null>(null);
export const connectionError = writable<string | null>(null);

export interface SseConnection {
  manager: SseManager;
  connect(): void;
  /** Force the connection-error state (wiring edge cases / tests). */
  fail(message: string): void;
  close(): void;
}

/**
 * Wire an SSE stream (`/api/events` or `/api/events/:runId`) to the sse +
 * runs stores: connection state → sseConnected/connectionError, each hub
 * event → lastEventTime + runs store status updates.
 */
export function createSseConnection(url: string, options: Partial<SseManagerOptions> = {}): SseConnection {
  const manager = new SseManager({
    url,
    onEvent: (event) => {
      lastEventTime.set(new Date());
      applySseEvent(event);
    },
    onStatus: (connected, error) => {
      sseConnected.set(connected);
      connectionError.set(connected ? null : (error ?? null));
    },
    ...options,
  });
  return {
    manager,
    connect: () => manager.connect(),
    fail: (message) => {
      sseConnected.set(false);
      connectionError.set(message);
    },
    close: () => {
      manager.close();
      sseConnected.set(false);
      connectionError.set(null);
    },
  };
}
