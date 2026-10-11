import { type ChildProcess, spawn } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { type Browser, type BrowserContext, chromium, type Page } from "playwright";

const here = path.dirname(fileURLToPath(import.meta.url));
export const repoRoot = path.resolve(here, "..", "..", "..");
const cliEntry = path.join(repoRoot, "dist", "cli.js");
const webuiDist = path.join(repoRoot, "src", "webui", "dist");

export interface ApiRun {
  runId: string;
  agent: string;
  tier: number;
  prompt: string;
  status: "running" | "done" | "failed" | "stuck";
  logFile: string;
}

/** A booted `at web` server: base URL, temp state dir, REST helper, close(). */
export interface WebE2E {
  baseUrl: string;
  stateDir: string;
  request<T>(method: "GET" | "POST" | "PUT" | "DELETE", apiPath: string, body?: unknown): Promise<T>;
  close(): Promise<void>;
}

/**
 * Boot `at web` on a random port with a temp AT_STATE_DIR, serving the built
 * WebUI. Mirrors `at web --port 0 --state-dir <tmp> --static src/webui/dist`.
 */
export async function startWeb(): Promise<WebE2E> {
  if (!existsSync(cliEntry)) throw new Error(`CLI not built: ${cliEntry} (pnpm run build)`);
  if (!existsSync(path.join(webuiDist, "index.html"))) {
    throw new Error(`WebUI not built: ${webuiDist} (pnpm run web:build)`);
  }
  const stateDir = mkdtempSync(path.join(os.tmpdir(), "at-webui-e2e-"));
  // Isolate HOME so the server and every run it spawns ignore the user's real
  // ~/.at (config globalPrompt, health, namer config) — tests must be hermetic.
  const homeDir = mkdtempSync(path.join(os.tmpdir(), "at-webui-e2e-home-"));
  const child = spawn(
    process.execPath,
    [cliEntry, "web", "--port", "0", "--state-dir", stateDir, "--static", webuiDist],
    {
      // stdin must not leak into spawned runs (mock merges stdin into prompt).
      // MOCK_BIN / MOCK_LONG_BIN: the registry resolves tier-4 mocks against
      // $HOME/.local/bin, which is empty in the isolated HOME — point them at
      // the repo-built mock binaries instead.
      env: {
        ...process.env,
        AT_STATE_DIR: stateDir,
        HOME: homeDir,
        MOCK_BIN: path.join(repoRoot, "bin", "mock-agent"),
        MOCK_LONG_BIN: path.join(repoRoot, "bin", "mock-long-agent"),
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  const baseUrl = await waitForBoot(child);
  let closed = false;

  return {
    baseUrl,
    stateDir,
    async request<T>(method: "GET" | "POST" | "PUT" | "DELETE", apiPath: string, body?: unknown): Promise<T> {
      const res = await fetch(`${baseUrl}${apiPath}`, {
        method,
        headers: body === undefined ? undefined : { "Content-Type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      if (!res.ok) throw new Error(`${method} ${apiPath} → ${res.status}: ${await res.text()}`);
      return (await res.json()) as T;
    },
    async close() {
      if (closed) return;
      closed = true;
      // Best-effort: stop any run still alive so no detached child outlives us.
      try {
        const runs = await this.request<ApiRun[]>("GET", "/api/runs");
        for (const run of runs.filter((r) => r.status === "running")) {
          await this.request("DELETE", `/api/runs/${encodeURIComponent(run.runId)}?force=1`).catch(() => {});
        }
      } catch {}
      child.kill("SIGTERM");
      await waitForExit(child, 5_000);
      rmSync(stateDir, { recursive: true, force: true });
      rmSync(homeDir, { recursive: true, force: true });
    },
  };
}

function waitForBoot(child: ChildProcess): Promise<string> {
  return new Promise((resolve, reject) => {
    let out = "";
    const timer = setTimeout(() => reject(new Error(`at web did not start. Output:\n${out}`)), 30_000);
    const onData = (chunk: Buffer) => {
      out += chunk.toString();
      const m = out.match(/\[at\] web: http:\/\/127\.0\.0\.1:(\d+)/);
      if (m) {
        clearTimeout(timer);
        resolve(`http://127.0.0.1:${m[1]}`);
      }
    };
    child.stdout?.on("data", onData);
    child.stderr?.on("data", onData);
    child.once("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.once("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`at web exited early (${code}). Output:\n${out}`));
    });
  });
}

function waitForExit(child: ChildProcess, timeoutMs: number): Promise<void> {
  return new Promise((resolve) => {
    if (child.exitCode !== null || child.signalCode !== null) return resolve();
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      resolve();
    }, timeoutMs);
    child.once("exit", () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

/** Launch headless chromium with a helpful error when the browser is missing. */
export async function launchBrowser(): Promise<Browser> {
  try {
    return await chromium.launch();
  } catch (err) {
    throw new Error(
      `chromium not available (${err instanceof Error ? err.message.split("\n")[0] : String(err)}). ` +
        `Run: PLAYWRIGHT_BROWSERS_PATH=$PWD/.pw-browsers pnpm exec playwright install chromium`,
    );
  }
}

/** Fresh browser context + page (isolated storage per test). */
export async function newPage(browser: Browser, baseUrl: string): Promise<Page> {
  const context: BrowserContext = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  await page.goto(baseUrl, { waitUntil: "domcontentloaded" });
  return page;
}

/** Poll GET /api/runs until `pred` matches a run; returns it. */
export async function waitForRun(
  web: WebE2E,
  pred: (run: ApiRun) => boolean,
  { timeoutMs = 60_000, intervalMs = 250 }: { timeoutMs?: number; intervalMs?: number } = {},
): Promise<ApiRun> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const runs = await web.request<ApiRun[]>("GET", "/api/runs");
    const hit = runs.find(pred);
    if (hit) return hit;
    if (Date.now() > deadline) {
      throw new Error(
        `timed out waiting for run (${runs.length} present: ${runs
          .map((r) => `${r.runId.slice(0, 8)}:${r.status}`)
          .join(", ")})`,
      );
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}

/**
 * Prompt that makes the tier-4 mock print a lorem paragraph and drop a marker
 * file. The `#NORMKA` directive must be followed by pure JSON: mock-agent
 * parses everything after the directive line as the spec.
 */
export function normkaPrompt(markerPath: string): string {
  const spec = JSON.stringify({
    version: 1,
    steps: [
      { kind: "lorem", paragraphs: 1 },
      { kind: "file", path: markerPath, content: "T14 e2e" },
    ],
  });
  return `#NORMKA\n${spec}`;
}
