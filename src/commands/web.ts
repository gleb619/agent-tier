import { type ChildProcess, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import type { Command } from "commander";
import { resolveWebUiStaticDir } from "../web/server";

const DEFAULT_PORT = "7800";
const DEFAULT_HOST = "127.0.0.1";
const BOOT_TIMEOUT_MS = 30_000;

export class WebBinError extends Error {}

function packageRoot(): string {
  return path.resolve(__dirname, "..", "..");
}

export function resolveWebBin(root: string, explicit?: string): string {
  if (explicit) {
    if (!existsSync(explicit)) {
      throw new WebBinError(`AT_WEB_BIN not found: ${explicit}\nBuild with: pnpm run build:go`);
    }
    return explicit;
  }

  const built = path.join(root, "bin", "at-web");
  if (existsSync(built)) {
    return built;
  }

  const fromPath = findInPath("at-web");
  if (fromPath) {
    return fromPath;
  }

  throw new WebBinError(
    "at-web binary not found.\n" +
      "Build it with: pnpm run build:go\n" +
      "Or install at-web into PATH / set AT_WEB_BIN.",
  );
}

function findInPath(name: string): string | undefined {
  const dirs = (process.env.PATH ?? "").split(path.delimiter).filter(Boolean);
  for (const dir of dirs) {
    const candidate = path.join(dir, name);
    if (existsSync(candidate)) {
      return candidate;
    }
  }
  return undefined;
}

interface WebServerChild {
  child: ChildProcess;
  baseUrl: string;
  stateDirs: string[];
}

async function bootWebServer(opts: {
  bin: string;
  port: number;
  host: string;
  staticDir?: string;
  stateDir?: string;
}): Promise<WebServerChild> {
  const args = ["--port", String(opts.port), "--host", opts.host];
  if (opts.staticDir) {
    args.push("--static", opts.staticDir);
  }
  if (opts.stateDir) {
    args.push("--state-dir", opts.stateDir);
  }

  const child = spawn(opts.bin, args, { stdio: ["ignore", "pipe", "pipe"] });

  const { baseUrl, stateDirs } = await new Promise<{ baseUrl: string; stateDirs: string[] }>((resolve, reject) => {
    let buffer = "";
    let settled = false;

    const finish = (result: { baseUrl: string; stateDirs: string[] }) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(result);
    };

    const fail = (err: Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      try {
        child.kill("SIGTERM");
      } catch {
        /* ignore */
      }
      reject(err);
    };

    const cleanup = () => {
      child.stdout?.off("data", onData);
      child.stderr?.off("data", onData);
    };

    const onData = (chunk: Buffer) => {
      buffer += chunk.toString();
      const match = buffer.match(/serving on (http:\/\/\S+)\s*\(state:\s*([^)]*)\)/);
      if (match) {
        finish({
          baseUrl: match[1]!,
          stateDirs: match[2]!
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean),
        });
      }
    };

    child.stdout?.on("data", onData);
    child.stderr?.on("data", onData);

    child.once("error", (err) => fail(err));
    child.once("exit", (code) => fail(new Error(`at-web exited early (code ${code})`)));

    const timer = setTimeout(() => {
      fail(new Error(`at-web did not announce a serving URL within ${BOOT_TIMEOUT_MS}ms`));
    }, BOOT_TIMEOUT_MS);

    // Prevent the timer from keeping the process alive after a quick failure.
    timer.unref();
  });

  child.stdout?.pipe(process.stdout);
  child.stderr?.pipe(process.stderr);

  return { child, baseUrl, stateDirs };
}

export function registerWebCommand(program: Command): void {
  program
    .command("web")
    .description("Start the WebUI server (REST + SSE + built Svelte app) for the state directory")
    .option("-p, --port <number>", "Port (0=random)", DEFAULT_PORT)
    .option("--host <address>", "Bind address (default: 127.0.0.1; use 0.0.0.0 for containers)", DEFAULT_HOST)
    .option(
      "--static <dir>",
      "Directory with the WebUI build to serve (default: built src/webui/dist when present; API-only otherwise)",
    )
    .option("--state-dir <dir>", "Explicit state directory (default: same resolution as at status)")
    .action(async (opts: { port: string; host: string; static?: string; stateDir?: string }) => {
      const root = packageRoot();
      let bin: string;
      try {
        bin = resolveWebBin(root, process.env.AT_WEB_BIN);
      } catch (err) {
        const message = err instanceof WebBinError ? err.message : String(err);
        console.error(`[at] web: ${message}`);
        process.exit(1);
      }

      const staticDir = resolveWebUiStaticDir(opts.static, root);

      try {
        const { child, baseUrl, stateDirs } = await bootWebServer({
          bin,
          port: Number(opts.port),
          host: opts.host,
          staticDir,
          stateDir: opts.stateDir,
        });

        const parsed = new URL(baseUrl);
        const host = parsed.hostname;
        const port = parsed.port;
        console.log(`[at] web: http://${host}:${port} (state: ${stateDirs.join(", ")})`);
        console.log(`[at] web: SSE http://${host}:${port}/api/events`);

        const shutdown = (signal: NodeJS.Signals) => {
          child.kill(signal);
        };
        process.on("SIGINT", () => shutdown("SIGINT"));
        process.on("SIGTERM", () => shutdown("SIGTERM"));
        child.once("exit", (code) => {
          process.exit(code ?? 0);
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`[at] web: ${message}`);
        process.exit(1);
      }
    });
}
