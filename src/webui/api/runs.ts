import type { ApiDiscussEntry, ApiRun, ApiRunLog, CreateRunInput, PostDiscussInput } from "$types/api";
import { api } from "./client";

/** Run-scoped endpoints of the default client (see ApiClient for semantics). */
export const listRuns = (): Promise<ApiRun[]> => api.getRuns();
export const getRun = (runId: string): Promise<ApiRun> => api.getRun(runId);
export const getRunLog = (runId: string, lines?: number): Promise<ApiRunLog> => api.getRunLog(runId, lines);
export const createRun = (input: CreateRunInput): Promise<{ ok: true }> => api.createRun(input);
export const retryRun = (runId: string): Promise<{ ok: true }> => api.retryRun(runId);
export const deleteRun = (runId: string, opts: { force?: boolean } = {}): Promise<{ ok: true }> =>
  api.deleteRun(runId, opts);
export const getRunDiscuss = (runId: string, pending = false): Promise<ApiDiscussEntry[]> =>
  api.getRunDiscuss(runId, pending);
export const postRunDiscuss = (runId: string, input: PostDiscussInput): Promise<{ id: string }> =>
  api.postRunDiscuss(runId, input);
