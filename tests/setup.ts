/**
 * Vitest global setup.
 * Sets AT_STATE_DIR to a unique temp directory per test run so tests
 * never pollute real ~/.at/runs.jsonl.
 */
import { spawnSync } from "node:child_process";
import { chmodSync, copyFileSync, existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

// Set AT_STATE_DIR at module level — before any imports resolve
process.env.AT_STATE_DIR = path.join(os.tmpdir(), `at-test-${process.pid}`);

// Discuss is experimental + opt-in; existing suites exercise it, gate tests unset this explicitly.
process.env.AT_DISCUSS = "1";

const atDir = process.env.AT_STATE_DIR;

// Build Go mock agents on demand if missing. bin/mock-agent and
// bin/mock-long-agent are gitignored (built by `pnpm run build:mock` /
// `make build`); without this guard a fresh checkout would ENOENT for any
// test that sets MOCK_BIN / MOCK_LONG_BIN to repo paths.
const repoRoot = path.resolve(__dirname, "..");
const mockBin = path.join(repoRoot, "bin", "mock-agent");
const mockLongBin = path.join(repoRoot, "bin", "mock-long-agent");
// Linked worktrees have no bin/ of their own: reuse the binaries already built in the main
// checkout (git common dir's parent) instead of recompiling Go in every worktree.
function copyFromMainCheckout(target: string): boolean {
  const r = spawnSync("git", ["rev-parse", "--git-common-dir"], {
    cwd: repoRoot,
    encoding: "utf8",
  });
  if (r.status !== 0) return false;
  const src = path.join(path.dirname(path.resolve(repoRoot, r.stdout.trim())), "bin", path.basename(target));
  if (src === target || !existsSync(src)) return false;
  mkdirSync(path.dirname(target), { recursive: true });
  copyFileSync(src, target);
  chmodSync(target, 0o755);
  return true;
}

function ensureMockBuilt(): void {
  for (const bin of [mockBin, mockLongBin]) {
    if (!existsSync(bin)) copyFromMainCheckout(bin);
  }
  if (existsSync(mockBin) && existsSync(mockLongBin)) return;
  const r = spawnSync("make", ["build"], { cwd: repoRoot, stdio: "inherit" });
  if (r.status !== 0) {
    throw new Error("make build failed — Go toolchain required to build bin/mock-agent");
  }
}

beforeAll(() => {
  mkdirSync(atDir, { recursive: true });
  writeFileSync(path.join(atDir, "state.json"), "{}", "utf8");
  ensureMockBuilt();
}, 180_000);

afterAll(() => {
  rmSync(atDir, { recursive: true, force: true });
  delete process.env.AT_STATE_DIR;
});

// Unit tests must NEVER launch real AI agents: a test that spawns the real CLI without `-a mock`
// would start detached kilo/codex/... runs that run the full suite again (recursive fan-out that
// froze the laptop). `at` honours this flag and only schedules tier-4 mock agents.
process.env.AT_FORBID_REAL_AGENTS = "1";
