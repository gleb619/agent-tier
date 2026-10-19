import { spawn, spawnSync } from "node:child_process";
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

const ROOT = join(__dirname, "..");
const SCRIPT = join(ROOT, "scripts", "test-guard.sh");

function run(args: string[], repo: string, env: Record<string, string> = {}): { status: number; out: string } {
  // ROOT derives from the script's own path, so a temp-repo check must invoke
  // that repo's copied script, not the real repo's.
  const script = repo === ROOT ? SCRIPT : join(repo, "scripts", "test-guard.sh");
  const res = spawnSync("bash", [script, ...args], {
    cwd: repo,
    encoding: "utf8",
    env: { ...process.env, ...env },
  });
  return { status: res.status ?? 1, out: `${res.stdout ?? ""}${res.stderr ?? ""}` };
}

/** Minimal repo skeleton the guard script can run against (package.json + vitest.config.ts). */
function makeTempRepo(configInclude: string, testScript = "vitest run"): string {
  const dir = mkdtempSync(join(tmpdir(), "at-test-guard-"));
  tempDirs.push(dir);
  mkdirSync(join(dir, "scripts"), { recursive: true });
  cpSync(SCRIPT, join(dir, "scripts", "test-guard.sh"));
  chmodSync(join(dir, "scripts", "test-guard.sh"), 0o755);
  writeFileSync(join(dir, "package.json"), JSON.stringify({ scripts: { test: testScript } }));
  writeFileSync(join(dir, "vitest.config.ts"), `export default { test: { include: [${configInclude}] } };\n`);
  return dir;
}

// Dummy orphan: node -e '<sleep>' <root>/dist/cli.js -s -a mock  → cmdline matches the
// guard pattern for that root, and for no other root.
function spawnDummy(root: string): any {
  return spawn(process.execPath, ["-e", "setTimeout(() => {}, 20000)", join(root, "dist/cli.js"), "-s", "-a", "mock"], {
    stdio: "ignore",
  });
}

const tempDirs: string[] = [];
afterAll(() => {
  for (const d of tempDirs) rmSync(d, { recursive: true, force: true });
});

describe("test-guard script", () => {
  it("exists and is executable", () => {
    const mode = spawnSync("stat", ["-c", "%a", SCRIPT], { encoding: "utf8" }).stdout.trim();
    expect(Number(mode) % 2).toBe(1);
  });

  it("check passes on the current repo (unit-only default path)", () => {
    const res = run(["check"], ROOT);
    expect(res.out).toMatch(/OK: default test path is unit-only/);
    expect(res.status).toBe(0);
  });

  it("check fails when vitest.config.ts includes tests_ai", () => {
    const dir = makeTempRepo(`"tests/**/*.test.ts", "tests_ai/**/*.test.ts"`);
    const res = run(["check"], dir);
    expect(res.status).toBe(1);
    expect(res.out).toMatch(/tests_ai/);
  });

  it("check fails when the package.json test script references tests_ai", () => {
    const dir = makeTempRepo(`"tests/**/*.test.ts"`, "vitest run tests_ai/");
    const res = run(["check"], dir);
    expect(res.status).toBe(1);
    expect(res.out).toMatch(/'test' script references tests_ai/);
  });

  it("check rejects AT_LIVE_AGENTS=1 under CI unless AT_ALLOW_LIVE=1", () => {
    const dir = makeTempRepo(`"tests/**/*.test.ts"`);
    expect(run(["check"], dir, { CI: "true", AT_LIVE_AGENTS: "1" }).status).toBe(1);
    expect(run(["check"], dir, { CI: "true", AT_LIVE_AGENTS: "1", AT_ALLOW_LIVE: "1" }).status).toBe(0);
    // no CI → live flag allowed (local dev)
    expect(run(["check"], dir, { AT_LIVE_AGENTS: "1" }).status).toBe(0);
  });

  it("orphans matches only the given root and --kill terminates them", async () => {
    const dir = makeTempRepo(`"tests/**/*.test.ts"`);
    const other = makeTempRepo(`"tests/**/*.test.ts"`);
    tempDirs.push(other);

    const mine = spawnDummy(dir);
    const theirs = spawnDummy(other);
    // wait for both processes to appear in /proc
    await new Promise((r) => setTimeout(r, 300));

    const listed = run(["orphans"], dir);
    expect(listed.status).toBe(0);
    expect(listed.out).toContain(String(mine.pid));
    expect(listed.out).not.toContain(String(theirs.pid));

    const killed = run(["orphans", "--kill"], dir);
    expect(killed.status).toBe(0);
    expect(killed.out).toContain("Killed orphans");
    // other worktree's process untouched
    expect(spawnSync("kill", ["-0", String(theirs.pid)]).status).toBe(0);
    // cleanup helper for the untouched process
    theirs.kill("SIGKILL");
    mine.kill("SIGKILL");
    void run(["orphans", "--kill"], other);
  }, 60000);

  it("worktree-clean removes a leftover skeleton directory with read-only files", () => {
    const dir = makeTempRepo(`"tests/**/*.test.ts"`);
    const skeleton = join(dir, "agent-tier-skeleton");
    const nested = join(skeleton, ".remember");
    mkdirSync(nested, { recursive: true });
    writeFileSync(join(nested, "lock"), "x");
    chmodSync(join(nested, "lock"), 0o444);
    chmodSync(nested, 0o555);
    chmodSync(skeleton, 0o555);
    const res = run(["worktree-clean", skeleton], dir);
    expect(res.status).toBe(0);
    expect(res.out).toMatch(/OK: no orphans/);
    expect(res.out).toMatch(/removing leftover skeleton/);
    expect(existsSync(skeleton)).toBe(false);
  });
});
