import type { Command } from "commander";
import { startHub } from "../notify/hub";
import { resolveStatusDirs } from "../state-dir";
import { resolveWebUiStaticDir, startWebServer } from "../web/server";

export function registerWebCommand(program: Command): void {
  program
    .command("web")
    .description("Start the WebUI server (REST + SSE + built Svelte app) for the state directory")
    .option("-p, --port <number>", "Port (0=random)", "7800")
    .option("--host <address>", "Bind address (default: 127.0.0.1; use 0.0.0.0 for containers)", "127.0.0.1")
    .option(
      "--static <dir>",
      "Directory with the WebUI build to serve (default: built src/webui/dist when present; API-only otherwise)",
    )
    .option("--state-dir <dir>", "Explicit state directory (default: same resolution as at status)")
    .action(async (opts: { port: string; host: string; static?: string; stateDir?: string }) => {
      const stateDirs = resolveStatusDirs(opts.stateDir);
      // Internal hub on a random port: runner processes POST their events to
      // it and the web server proxies /api/events onto its SSE stream.
      const hub = await startHub({ stateDir: stateDirs[0]!, port: 0 });
      const server = await startWebServer({
        stateDirs,
        hub,
        port: Number(opts.port),
        host: opts.host,
        staticDir: resolveWebUiStaticDir(opts.static),
      });
      console.log(`[at] web: http://${opts.host}:${server.port} (state: ${stateDirs.join(", ")})`);
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
