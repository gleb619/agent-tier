import { api } from "./client";

/** `PUT /api/agents/:name/enable|disable` — the Go server execs `at enable|disable`. */
export const setAgentEnabled = (name: string, enabled: boolean): Promise<void> => api.setAgentEnabled(name, enabled);
