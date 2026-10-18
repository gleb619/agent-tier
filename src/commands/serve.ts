import type { Command } from "commander";
import { withLock } from "../lock";
import {
  DAEMON_VERSION,
  type DaemonFrameHandler,
  type DaemonRequest,
  daemonSockPath,
  removeDaemonPidFile,
  startDaemonServer,
  writeDaemonPidFile,
} from "../notify/daemon-sock";
import { createIngest, type Hub, ingestDiscuss, startHub } from "../notify/hub";
import type { NotifyEvent } from "../notify/types";
import { addRunLocal, pruneRunsLocal, refreshRunsLocal, updateRunLocal } from "../run-store";
import { loadStateFile, saveStateFile } from "../scheduler";
import { getStateFilePath, resolveStateDir } from "../state-dir";

export interface DaemonHandle {
  sockPath: string;
  /** TCP port of the co-mounted SSE hub, 0 when `serveHttp` was disabled. */
  port: number;
  close(): Promise<void>;
}

type Publisher = (event: NotifyEvent) => NotifyEvent;

/**
 * The daemon hub: one shared unix socket (`<stateDir>/daemon.sock`) that agents
 * emit/discuss through instead of a per-run `--sse` hub, plus the lock broker
 * that serializes `runs.jsonl` and `state.json` writes for every `at` process.
 *
 * When `serveHttp` is on (the CLI default) the daemon also owns the SSE hub, so
 * live viewers read the same writer instead of one hub per run.
 */
export async function startDaemon({
  stateDir,
  port = 7777,
  serveHttp = true,
  warn = (m) => console.warn(m),
}: {
  stateDir: string;
  port?: number;
  serveHttp?: boolean;
  warn?: (msg: string) => void;
}): Promise<DaemonHandle> {
  const hub: Hub | null = serveHttp ? await startHub({ stateDir, port, warn }) : null;
  const ingest = hub ?? createIngest(stateDir);
  const publish: Publisher = (e) => ingest.publish(e);

  const server = await startDaemonServer({
    stateDir,
    handler: createDaemonHandler(stateDir, publish, { ssePort: hub?.port ?? 0 }),
  });

  return {
    sockPath: server.sockPath,
    port: hub?.port ?? 0,
    async close(): Promise<void> {
      await server.close();
      await hub?.close();
    },
  };
}

/**
 * Request dispatch for the daemon socket. `emit`/`discuss` reuse the hub's
 * writer (one seq/id allocator for both transports); the `runs.*` and `state.*`
 * ops are the broker: they run the same mutation the CLI would, but always
 * under the file lock, in the daemon — so concurrent `at` processes queue here
 * instead of racing each other on disk.
 */
export function createDaemonHandler(
  stateDir: string,
  publish: Publisher,
  info: { ssePort: number } = { ssePort: 0 },
): DaemonFrameHandler {
  return async (req: DaemonRequest): Promise<unknown> => {
    const payload = (req.payload ?? {}) as Record<string, unknown>;
    const target = typeof payload.stateDir === "string" ? payload.stateDir : stateDir;

    switch (req.op) {
      case "ping":
        return {
          pong: true,
          version: DAEMON_VERSION,
          pid: process.pid,
          port: info.ssePort,
          sockPath: daemonSockPath(stateDir),
        };

      case "emit": {
        const event = payload as unknown as NotifyEvent;
        if (typeof event.runId !== "string" || !event.runId) throw new Error("emit: runId is required");
        const stored = publish(event);
        return { seq: stored.seq };
      }

      case "discuss": {
        const runId = typeof payload.runId === "string" ? payload.runId : "";
        if (!runId) throw new Error("discuss: runId is required");
        const entry = ingestDiscuss(stateDir, runId, payload, publish);
        if (!entry) throw new Error("discuss: bad payload (text + kind required)");
        return { id: entry.id };
      }

      case "runs.add":
        await addRunLocal(target, payload.record as Parameters<typeof addRunLocal>[1]);
        return { applied: true };

      case "runs.update":
        await updateRunLocal(target, String(payload.runId ?? ""), (payload.updates ?? {}) as never);
        return { applied: true };

      case "runs.prune":
        await pruneRunsLocal(target);
        return { applied: true };

      case "runs.refresh":
        return { runs: await refreshRunsLocal(target) };

      case "state.pick": {
        const file = typeof payload.stateFilePath === "string" ? payload.stateFilePath : getStateFilePath(target);
        const key = typeof payload.key === "string" ? payload.key : "default";
        const count = Number(payload.count);
        if (!Number.isInteger(count) || count <= 0) throw new Error("state.pick: count must be a positive integer");
        const index = await withLock(file, () => {
          const state = loadStateFile(file);
          if (!state.scheduler) state.scheduler = {};
          const current = state.scheduler[key]?.index ?? -1;
          const next = (current + 1) % count;
          state.scheduler[key] = { index: next };
          saveStateFile(file, state);
          return next;
        });
        return { index };
      }

      case "state.patch": {
        const file = typeof payload.stateFilePath === "string" ? payload.stateFilePath : getStateFilePath(target);
        const key = payload.key;
        if (typeof key !== "string" || !key) throw new Error("state.patch: key is required");
        await withLock(file, () => {
          const state = loadStateFile(file) as Record<string, unknown>;
          state[key] = payload.value;
          saveStateFile(file, state as never);
        });
        return { applied: true };
      }

      default:
        throw new Error(`unknown daemon op: ${req.op}`);
    }
  };
}

export function registerServeCommand(program: Command): void {
  program
    .command("serve")
    .description("Start standalone SSE events hub for the state directory")
    .option("-p, --port <number>", "Port (0=random)", "7777")
    .option("-d, --daemon", "Run as the daemon hub: unix socket + state/runs lock broker", false)
    .action(async (opts: { port: string; daemon?: boolean }) => {
      const stateDir = resolveStateDir();
      const port = Number(opts.port);

      const shutdown = (stop: () => Promise<void>) => {
        const handler = async () => {
          await stop();
          process.exit(0);
        };
        process.on("SIGINT", handler);
        process.on("SIGTERM", handler);
      };

      if (opts.daemon) {
        const daemon = await startDaemon({ stateDir, port });
        writeDaemonPidFile(stateDir);
        console.log(`[at] serve --daemon: ${daemon.sockPath}`);
        console.log(`[at] serve: http://127.0.0.1:${daemon.port}/events`);
        shutdown(async () => {
          removeDaemonPidFile(stateDir);
          await daemon.close();
        });
        return;
      }

      const hub = await startHub({ stateDir, port });
      console.log(`[at] serve: http://127.0.0.1:${hub.port}/events`);
      shutdown(() => hub.close());
    });
}
