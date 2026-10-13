import { writable } from "svelte/store";

export interface Toast {
  id: number;
  message: string;
  kind: "info" | "success" | "error";
  action?: { label: string; onClick: () => void };
}

export const toasts = writable<Toast[]>([]);

let nextId = 0;

/** Push a toast; auto-dismisses after `timeoutMs` (0 = sticky). */
export function showToast(
  message: string,
  kind: Toast["kind"] = "info",
  timeoutMs = 4000,
  action?: Toast["action"],
): void {
  const id = nextId++;
  toasts.update((list) => [...list, { id, message, kind, action }]);
  if (timeoutMs > 0) {
    setTimeout(() => dismissToast(id), timeoutMs);
  }
}

export function dismissToast(id: number): void {
  toasts.update((list) => list.filter((t) => t.id !== id));
}
