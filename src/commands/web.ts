import type { Command } from "commander";
import { startHub } from "../notify/hub";
import { resolveStatusDirs } from "../state-dir";
import { startWebServer } from "../web/server";

export function registerWebCommand(program: Command): void {
  program
    .command("web")
    .description("Start the WebUI API server (REST + SSE + static) for the state directory")
    .option("-p, --port <number>", "Port (0=random)", "7800")
    .option("--static <dir>", "Directory with the WebUI build to serve (omitted = API only)")
    .option("--state-dir <dir>", "Explicit state directory (default: same resolution as at status)")
    .action(async (opts: { port: string; static?: string; stateDir?: string }) => {
      const stateDirs = resolveStatusDirs(opts.stateDir);
      // Internal hub on a random port: runner processes POST their events to
      // it and the web server proxies /api/events onto its SSE stream.
      const hub = await startHub({ stateDir: stateDirs[0]!, port: 0 });
      const server = await startWebServer({
        stateDirs,
        hub,
        port: Number(opts.port),
        staticDir: opts.static,
      });
      console.log(`[at] web: http://127.0.0.1:${server.port} (state: ${stateDirs.join(", ")})`);
      console.log(`[at] web: SSE http://127.0.0.1:${server.port}/api/events`);
      const shutdown = async () => {
        await server.close();
        await hub.close();
        process.exit(0);
      };
      process.on("SIGINT", () => void shutdown());
      process.on("SIGTERM", () => void shutdown());
    });
}
