import { execFileSync, execSync } from "node:child_process";
import { existsSync, lstatSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const ROOT = join(__dirname, "..");
const SCRIPT = join(ROOT, "scripts", "worktree-new.sh");

let testRepoDir: string;
let testRepoNodeModules: string;

beforeAll(() => {
  testRepoDir = join(tmpdir(), `worktree-test-${Date.now()}`);
  testRepoNodeModules = join(testRepoDir, "node_modules");
  execSync(`mkdir -p "${testRepoDir}"`, { stdio: "pipe" });
  execSync(`git init`, { cwd: testRepoDir, stdio: "pipe" });
  execSync(`git config user.email "test@example.com"`, { cwd: testRepoDir, stdio: "pipe" });
  execSync(`git config user.name "Test"`, { cwd: testRepoDir, stdio: "pipe" });
  execSync(`mkdir -p "${testRepoNodeModules}"`, { stdio: "pipe" });
  execSync(`git checkout -b main`, { cwd: testRepoDir, stdio: "pipe" });
  execSync(`echo "test" > test.txt`, { cwd: testRepoDir, stdio: "pipe" });
  execSync(`git add .`, { cwd: testRepoDir, stdio: "pipe" });
  execSync(`git commit -m "init"`, { cwd: testRepoDir, stdio: "pipe" });
});

afterAll(() => {
  if (existsSync(testRepoDir)) {
    rmSync(testRepoDir, { recursive: true, force: true });
  }
  const worktreePath = join(testRepoDir, "..", "agent-tier-test-feature");
  if (existsSync(worktreePath)) {
    rmSync(worktreePath, { recursive: true, force: true });
  }
});

function runScript(shortName: string): { status: number; out: string } {
  try {
    const out = execFileSync("bash", [SCRIPT, shortName], {
      encoding: "utf8",
      cwd: testRepoDir,
    });
    return { status: 0, out };
  } catch (err: any) {
    return { status: err.status ?? 1, out: `${err.stdout ?? ""}${err.stderr ?? ""}` };
  }
}

describe("worktree-new.sh script", () => {
  it("exists and is executable", () => {
    expect(existsSync(SCRIPT)).toBe(true);
    const mode = execFileSync("stat", ["-c", "%a", SCRIPT], { encoding: "utf8" }).trim();
    expect(Number(mode) % 2).toBe(1);
  });

  it("passes bash -n syntax check", () => {
    expect(() => execFileSync("bash", ["-n", SCRIPT])).not.toThrow();
  });

  it("has set -euo pipefail", () => {
    const sh = readFileSync(SCRIPT, "utf8");
    expect(sh).toMatch(/set -euo pipefail/);
  });

  it("creates worktree and symlink when run from main checkout", () => {
    const res = runScript("test-feature");
    expect(res.status).toBe(0);
    const worktreePath = join(testRepoDir, "..", "agent-tier-test-feature");
    expect(existsSync(worktreePath)).toBe(true);
    const worktreeNodeModules = join(worktreePath, "node_modules");
    expect(existsSync(worktreeNodeModules)).toBe(true);
    expect(lstatSync(worktreeNodeModules).isSymbolicLink()).toBe(true);
  });

  it("is idempotent: re-running ensures symlink exists", () => {
    const res1 = runScript("test-feature");
    expect(res1.status).toBe(0);
    const res2 = runScript("test-feature");
    expect(res2.status).toBe(0);
    const worktreePath = join(testRepoDir, "..", "agent-tier-test-feature");
    const worktreeNodeModules = join(worktreePath, "node_modules");
    expect(existsSync(worktreeNodeModules)).toBe(true);
    expect(lstatSync(worktreeNodeModules).isSymbolicLink()).toBe(true);
  });

  it("prints the worktree path", () => {
    const res = runScript("test-feature");
    expect(res.status).toBe(0);
    const worktreePath = join(testRepoDir, "..", "agent-tier-test-feature");
    expect(res.out.trim()).toBe(worktreePath);
  });
});
