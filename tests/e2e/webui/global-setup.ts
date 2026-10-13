import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..", "..", "..");

function run(cmd: string, args: string[], cwd: string): void {
  // vitest sets NODE_ENV=test; a Vite build under that env sets import.meta.env.DEV=true,
  // which silently strips service-worker registration from the bundle. Always build for production.
  const r = spawnSync(cmd, args, { cwd, stdio: "inherit", env: { ...process.env, NODE_ENV: "production" } });
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(" ")} failed in ${cwd}`);
}

/**
 * Vitest global setup for the WebUI E2E suite: build the CLI (tsc → dist/)
 * and the WebUI (vite → src/webui/dist) once per run. Specs boot `at web`
 * against these artifacts.
 */
export default function setup(): void {
  run("pnpm", ["run", "build"], repoRoot);
  run("make", ["build"], repoRoot);
  run("pnpm", ["run", "web:build"], repoRoot);
}
