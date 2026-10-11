import type {
  ApiAgent,
  ApiDiscussEntry,
  ApiRun,
  ApiRunLog,
  ApiSettings,
  ApiStats,
  CreateRunInput,
  PostDiscussInput,
} from "$types/api";

/** HTTP error from the API server; `message` is the server's `error` field when present. */
export class ApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

/** Typed fetch client for the `at web` REST API (src/web/server.ts). */
export class ApiClient {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;

  /**
   * @param baseUrl  prepended to every path; empty = same origin (dev proxy / prod static server)
   * @param fetchImpl injectable fetch for tests
   */
  constructor(baseUrl = "", fetchImpl?: typeof fetch) {
    this.baseUrl = baseUrl;
    // Resolved per call (not bound at construction) so test spies on globalThis.fetch work.
    this.fetchImpl = fetchImpl ?? ((input, init) => globalThis.fetch(input, init));
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await this.fetchImpl(`${this.baseUrl}${path}`, {
      method,
      headers: body === undefined ? undefined : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!res.ok) throw new ApiError(res.status, await errorMessage(res));
    return (await res.json()) as T;
  }

  getRuns(): Promise<ApiRun[]> {
    return this.request("GET", "/api/runs");
  }

  getRun(runId: string): Promise<ApiRun> {
    return this.request("GET", `/api/runs/${encodeURIComponent(runId)}`);
  }

  getRunLog(runId: string, lines?: number): Promise<ApiRunLog> {
    const query = lines === undefined ? "" : `?lines=${lines}`;
    return this.request("GET", `/api/runs/${encodeURIComponent(runId)}/log${query}`);
  }

  /** Accepted (202) — the run is spawned detached and records itself asynchronously. */
  createRun(input: CreateRunInput): Promise<{ ok: true }> {
    return this.request("POST", "/api/runs", input);
  }

  retryRun(runId: string): Promise<{ ok: true }> {
    return this.request("POST", `/api/runs/${encodeURIComponent(runId)}/retry`);
  }

  /** Kills the run's process (SIGTERM, SIGKILL with force) and marks it failed. */
  deleteRun(runId: string, opts: { force?: boolean } = {}): Promise<{ ok: true }> {
    return this.request("DELETE", `/api/runs/${encodeURIComponent(runId)}${opts.force ? "?force=1" : ""}`);
  }

  /** Discuss thread of a run; `pending` returns only unanswered questions. */
  getRunDiscuss(runId: string, pending = false): Promise<ApiDiscussEntry[]> {
    const query = pending ? "?pending=1" : "";
    return this.request("GET", `/api/runs/${encodeURIComponent(runId)}/discuss${query}`);
  }

  /** Post a host entry (answer/say/note/question) to the run's discuss thread. */
  postRunDiscuss(runId: string, input: PostDiscussInput): Promise<{ id: string }> {
    return this.request("POST", `/api/runs/${encodeURIComponent(runId)}/discuss`, input);
  }

  getAgents(): Promise<ApiAgent[]> {
    return this.request("GET", "/api/agents");
  }

  getStats(): Promise<ApiStats> {
    return this.request("GET", "/api/stats");
  }

  getSettings(): Promise<ApiSettings> {
    return this.request("GET", "/api/settings");
  }

  putSettings(settings: ApiSettings): Promise<ApiSettings> {
    return this.request("PUT", "/api/settings", settings);
  }
}

async function errorMessage(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { error?: unknown };
    if (typeof body?.error === "string") return body.error;
  } catch {}
  return `HTTP ${res.status}`;
}

/** Default same-origin client (dev: Vite proxies /api → at web; prod: served by `at web`). */
export const api = new ApiClient();
