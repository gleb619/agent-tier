/**
 * Vitest global setup.
 * Sets AT_STATE_DIR to a unique temp directory per test run so tests
 * never pollute real ~/.at/runs.jsonl.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

// Set AT_STATE_DIR at module level — before any imports resolve
process.env.AT_STATE_DIR = path.join(os.tmpdir(), `at-test-${process.pid}`);

const atDir = process.env.AT_STATE_DIR;

// Build Go mock agents on demand if missing. bin/mock-agent and
// bin/mock-long-agent are gitignored (built by `pnpm run build:mock` /
// `make build`); without this guard a fresh checkout would ENOENT for any
// test that sets MOCK_BIN / MOCK_LONG_BIN to repo paths.
const repoRoot = path.resolve(__dirname, "..");
const mockBin = path.join(repoRoot, "bin", "mock-agent");
const mockLongBin = path.join(repoRoot, "bin", "mock-long-agent");
function ensureMockBuilt(): void {
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
});

afterAll(() => {
  rmSync(atDir, { recursive: true, force: true });
  delete process.env.AT_STATE_DIR;
});

// Unit tests must NEVER launch real AI agents: a test that spawns the real CLI without `-a mock`
// would start detached kilo/codex/... runs that run the full suite again (recursive fan-out that
// froze the laptop). `at` honours this flag and only schedules tier-4 mock agents.
process.env.AT_FORBID_REAL_AGENTS = "1";
