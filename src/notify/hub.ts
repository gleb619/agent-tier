import { existsSync, readdirSync } from "node:fs";
import http from "node:http";
import type { Socket } from "node:net";
import { autostartDaemon, connectDaemon, emitViaDaemon, isDaemonUp, requestDaemon } from "./daemon-sock";
import { appendDiscuss, nextDiscussId, readThread, unansweredQuestions } from "./discuss-store";
import { appendEvent, getEventsDir, readEvents, readEventsSince } from "./store";
import type { DiscussEntry, DiscussFrom, NotifyEvent } from "./types";

export interface Hub {
  port: number;
  /** The port requested by the caller (may differ from `port` if busy-port fallback kicked in). */
  requestedPort: number;
  /** True iff at least one SSE client was connected since the hub was created. */
  hadActiveClients: boolean;
  close(): Promise<void>;
  publish(event: NotifyEvent): NotifyEvent;
}

/**
 * Persists events into `<stateDir>/events/<runId>.jsonl`, assigning the
 * per-run sequence number from the tail of that file. The HTTP hub and the
 * daemon socket server both publish through one instance, so the seq counter
 * stays monotonic for whoever is the live writer.
 */
export interface EventIngest {
  publish(event: NotifyEvent): NotifyEvent;
}

export function createIngest(stateDir: string): EventIngest {
  const seqMap: Map<string, number> = new Map();

  function nextSeq(runId: string): number {
    if (!seqMap.has(runId)) seqMap.set(runId, maxSeqForRun(readEvents(stateDir, runId)) + 1);
    const seq = seqMap.get(runId) ?? 1;
    seqMap.set(runId, seq + 1);
    return seq;
  }

  return {
    publish(event: NotifyEvent): NotifyEvent {
      const e: NotifyEvent = {
        ...event,
        seq: event.seq > 0 ? event.seq : nextSeq(event.runId),
        ts: event.ts || new Date().toISOString(),
      };
      appendEvent(stateDir, e);
      return e;
    },
  };
}

/**
 * Validate a client-supplied discuss payload and allocate its thread id.
 * Returns null on anything malformed so both transports (HTTP + daemon sock)
 * reject the same way without duplicating the rules.
 */
export function buildDiscussEntry(stateDir: string, runId: string, raw: unknown): DiscussEntry | null {
  if (!raw || typeof raw !== "object") return null;
  const parsed = raw as {
    from?: unknown;
    kind?: unknown;
    text?: unknown;
    options?: unknown;
    replyTo?: unknown;
  };
  const from: DiscussFrom = parsed.from === "host" ? "host" : "agent";
  const kind = parsed.kind;
  const text = typeof parsed.text === "string" ? parsed.text : "";
  if (!text || (kind !== "question" && kind !== "answer" && kind !== "say" && kind !== "note")) return null;

  const entry: DiscussEntry = { id: nextDiscussId(stateDir, runId), from, kind, text, ts: new Date().toISOString() };
  const options = Array.isArray(parsed.options)
    ? parsed.options.filter((o): o is string => typeof o === "string")
    : undefined;
  if (options?.length) entry.options = options;
  const replyTo = typeof parsed.replyTo === "string" ? parsed.replyTo : undefined;
  if (replyTo) entry.replyTo = replyTo;
  return entry;
}

/** Append to the thread and mirror it as an SSE-shaped event. */
export function ingestDiscuss(
  stateDir: string,
  runId: string,
  raw: unknown,
  publish: (event: NotifyEvent) => NotifyEvent,
): DiscussEntry | null {
  const entry = buildDiscussEntry(stateDir, runId, raw);
  if (!entry) return null;
  appendDiscuss(stateDir, runId, entry);

  // question/answer -> matching event type; say/note -> 'message'
  const sseType: NotifyEvent["type"] = entry.kind === "question" || entry.kind === "answer" ? entry.kind : "message";
  publish({
    runId,
    agent: entry.from,
    ts: entry.ts,
    seq: 0,
    type: sseType,
    text: entry.text,
    data: {
      id: entry.id,
      kind: entry.kind,
      options: entry.options,
      replyTo: entry.replyTo,
      from: entry.from,
    },
  });
  return entry;
}

/**
 * A `Hub` backed by the daemon socket instead of a per-run TCP listen.
 *
 * `at serve --daemon` already owns the writer (event seq, `events/*.jsonl`) and
 * the SSE port for the whole state dir, so a run that finds the daemon alive
 * routes its publishes through the sock and skips binding its own port. The
 * queue keeps events in order across the async hop; `close()` drains it so the
 * final `done` event is not lost when the CLI exits.
 */
export async function startDaemonBackedHub(
  stateDir: string,
  opts?: { timeoutMs?: number; warn?: (msg: string) => void; autostart?: boolean },
): Promise<Hub | null> {
  const warn = opts?.warn ?? ((m: string) => console.warn(m));
  if (!isDaemonUp(stateDir)) {
    if (!opts?.autostart) return null;
    const client = await connectDaemon(stateDir, { spawn: autostartDaemon, timeoutMs: opts.timeoutMs ?? 2000 });
    if (!client) return null;
    client.close();
  }

  const ping = await requestDaemon(stateDir, "ping", undefined, { timeoutMs: opts?.timeoutMs ?? 500 });
  if (!ping?.ok) return null;
  const info = ping.data as { port?: number; sockPath?: string } | undefined;
  const port = typeof info?.port === "number" ? info.port : 0;
  // No SSE endpoint to hand out means adapters/agents could not subscribe —
  // the local hub is the better writer in that case.
  if (port <= 0) return null;

  let queue: Promise<void> = Promise.resolve();
  return {
    port,
    requestedPort: port,
    hadActiveClients: false,
    publish(event: NotifyEvent): NotifyEvent {
      queue = queue
        .then(async () => {
          if (!(await emitViaDaemon(stateDir, event))) warn(`[at] daemon dropped event for run ${event.runId}`);
        })
        .catch(() => {});
      return event;
    },
    async close(): Promise<void> {
      await queue;
    },
  };
}

interface Client {
  res: http.ServerResponse;
  runId?: string;
  sinceSeq: number;
  socket: Socket | null;
}

function sseLine(event: NotifyEvent): string {
  return `id: ${event.seq}\nevent: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
}

function maxSeqForRun(events: NotifyEvent[]): number {
  return events.reduce((m, e) => (e.seq > m ? e.seq : m), 0);
}

/**
 * Listen on the requested port; if it is busy AND a non-zero port, fall back
 * to an OS-assigned random port and log a warning. A requested port of 0
 * is treated as "give me any free port" with no warning.
 */
function listenWithFallback(server: http.Server, port: number, warn: (msg: string) => void): Promise<number> {
  return new Promise((resolve, reject) => {
    let triedFallback = false;
    const attempt = (p: number) => {
      const onError = (err: Error) => {
        server.removeListener("listening", onListening);
        const code = (err as NodeJS.ErrnoException).code;
        if (!triedFallback && p !== 0 && code === "EADDRINUSE") {
          triedFallback = true;
          warn(`[at] SSE hub port ${p} busy, falling back to random port`);
          attempt(0);
          return;
        }
        reject(err);
      };
      const onListening = () => {
        server.removeListener("error", onError);
        const addr = server.address();
        resolve(typeof addr === "object" && addr ? addr.port : p);
      };
      server.once("error", onError);
      server.once("listening", onListening);
      server.listen(p, "127.0.0.1");
    };
    attempt(port);
  });
}

export function startHub({
  stateDir,
  port,
  warn = (m) => console.warn(m),
}: {
  stateDir: string;
  port: number;
  warn?: (msg: string) => void;
}): Promise<Hub> {
  const clients: Set<Client> = new Set();
  let hadActiveClients = false;
  const ingest = createIngest(stateDir);

  function broadcast(event: NotifyEvent): NotifyEvent {
    const e = ingest.publish(event);
    const line = sseLine(e);
    for (const client of clients) {
      if (client.runId === undefined || client.runId === e.runId) {
        try {
          client.res.write(line);
        } catch {}
      }
    }
    return e;
  }

  function replaySingle(client: Client, runId: string): void {
    const events = readEventsSince(stateDir, runId, client.sinceSeq);
    for (const e of events) {
      try {
        client.res.write(sseLine(e));
      } catch {}
    }
  }

  function replayAll(client: Client): void {
    const dir = getEventsDir(stateDir);
    if (!existsSync(dir)) return;
    const files = readdirSync(dir).filter((f) => f.endsWith(".jsonl"));
    const all: NotifyEvent[] = [];
    for (const f of files) {
      const runId = f.slice(0, -6);
      all.push(...readEventsSince(stateDir, runId, client.sinceSeq));
    }
    all.sort((a, b) => a.seq - b.seq);
    for (const e of all) {
      try {
        client.res.write(sseLine(e));
      } catch {}
    }
  }

  const server = http.createServer((req, res) => {
    const url = req.url ?? "/";
    const runMatch = url.match(/^\/events\/([^/]+)$/);
    if (runMatch && req.method === "GET") {
      const runId = decodeURIComponent(runMatch[1]);
      const sinceSeq = Number(req.headers["last-event-id"] ?? 0);
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      });
      res.flushHeaders();
      const client: Client = { res, runId, sinceSeq, socket: res.socket };
      clients.add(client);
      hadActiveClients = true;
      replaySingle(client, runId);
      req.on("close", () => clients.delete(client));
      req.on("error", () => clients.delete(client));
      return;
    }

    if (url === "/events" && req.method === "GET") {
      const sinceSeq = Number(req.headers["last-event-id"] ?? 0);
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      });
      res.flushHeaders();
      const client: Client = { res, sinceSeq, socket: res.socket };
      clients.add(client);
      hadActiveClients = true;
      replayAll(client);
      req.on("close", () => clients.delete(client));
      req.on("error", () => clients.delete(client));
      return;
    }

    const emitMatch = url.match(/^\/emit\/([^/]+)$/);
    if (emitMatch && req.method === "POST") {
      const runId = decodeURIComponent(emitMatch[1]);
      let body = "";
      req.setEncoding("utf8");
      req.on("data", (chunk) => (body += chunk));
      req.on("end", () => {
        try {
          const parsed = JSON.parse(body) as Omit<NotifyEvent, "runId" | "agent" | "ts" | "seq">;
          broadcast({ ...parsed, runId, agent: "agent", ts: new Date().toISOString(), seq: 0 } as NotifyEvent);
          res.writeHead(202);
          res.end("ok");
        } catch {
          res.writeHead(400);
          res.end("bad request");
        }
      });
      return;
    }

    const discussMatch = url.match(/^\/discuss\/([^/?]+)(\?.*)?$/);
    if (discussMatch) {
      const runId = decodeURIComponent(discussMatch[1]);
      if (req.method === "GET") {
        const pending = /[?&]pending=1\b/.test(url);
        const list = pending ? unansweredQuestions(stateDir, runId) : readThread(stateDir, runId);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(list));
        return;
      }
      if (req.method === "POST") {
        let body = "";
        req.setEncoding("utf8");
        req.on("data", (chunk) => (body += chunk));
        req.on("end", () => {
          let parsed: unknown;
          try {
            parsed = JSON.parse(body);
          } catch {
            res.writeHead(400);
            res.end("bad request");
            return;
          }
          const entry = ingestDiscuss(stateDir, runId, parsed, broadcast);
          if (!entry) {
            res.writeHead(400);
            res.end("bad request");
            return;
          }
          res.writeHead(202);
          res.end(JSON.stringify({ id: entry.id }));
        });
        return;
      }
    }

    res.writeHead(404);
    res.end("not found");
  });

  return listenWithFallback(server, port, warn).then((actualPort) => ({
    port: actualPort,
    requestedPort: port,
    hadActiveClients,
    close: closeServer,
    publish: broadcast,
  }));

  function closeServer(): Promise<void> {
    // End + destroy every open SSE response + its socket so the http server
    // is not stuck waiting on keep-alive connections to drain on its own.
    for (const client of clients) {
      try {
        client.res.end();
      } catch {}
      const sock = client.socket ?? (client.res as unknown as { socket?: import("net").Socket }).socket;
      if (sock && typeof sock.destroy === "function" && !sock.destroyed) {
        try {
          sock.destroy();
        } catch {}
      }
    }
    clients.clear();

    // Node 18.2+ — destroys any remaining idle/active connections on the
    // server, so server.close() can settle promptly.
    const maybe = server as unknown as { closeAllConnections?: () => void };
    if (typeof maybe.closeAllConnections === "function") {
      try {
        maybe.closeAllConnections();
      } catch {}
    }

    return new Promise((resolve) => {
      server.close(() => resolve());
      // If the server has no listeners at all (e.g. listen failed), the
      // callback will never fire. Give it 1s then resolve anyway.
      setTimeout(resolve, 1000).unref();
    });
  }
}
