import { execSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";

import { buildSummary, defaultGitRunner } from "../src/summary";

function tmpDir(): string {
  const d = path.join("/tmp", `at-summary-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  fs.mkdirSync(d, { recursive: true });
  return d;
}

describe("buildSummary", () => {
  let origCwd: string;

  beforeEach(() => {
    origCwd = process.cwd();
  });

  afterEach(() => {
    process.chdir(origCwd);
  });

  it("produces valid JSON with all required fields when git repo has changes", () => {
    const testDir = tmpDir();
    try {
      process.chdir(testDir);
      execSync("git init", { stdio: "ignore" });
      execSync("git config user.name 'Test User'", { stdio: "ignore" });
      execSync("git config user.email 'test@example.com'", { stdio: "ignore" });
      fs.writeFileSync("test.txt", "hello world");
      execSync("git add test.txt", { stdio: "ignore" });
      execSync("git commit -m 'initial'", { stdio: "ignore" });

      // Make a change
      fs.writeFileSync("test.txt", "hello world changed");

      const git = defaultGitRunner();
      const result = buildSummary(
        {
          runId: "test-run-123",
          agent: "opencode",
          tier: 2,
          status: "done" as const,
          exitCode: 0,
          durationMs: 2450,
          cwd: testDir,
          verifyRan: false,
          verifyExitCode: null,
        },
        git,
      );

      const parsed = JSON.parse(result);
      expect(parsed).toHaveProperty("runId");
      expect(parsed).toHaveProperty("agent");
      expect(parsed).toHaveProperty("tier");
      expect(parsed).toHaveProperty("status");
      expect(parsed).toHaveProperty("exitCode");
      expect(parsed).toHaveProperty("durationMs");
      expect(parsed).toHaveProperty("filesChanged");
      expect(parsed).toHaveProperty("diffstat");
      expect(parsed).toHaveProperty("verify");
      expect(parsed).toHaveProperty("verify.ran");
      expect(parsed).toHaveProperty("verify.exitCode");

      expect(parsed.agent).toBe("opencode");
      expect(parsed.tier).toBe(2);
      expect(parsed.status).toBe("done");
      expect(parsed.exitCode).toBe(0);
      expect(parsed.durationMs).toBe(2450);
      expect(parsed.verify.ran).toBe(false);
      expect(parsed.verify.exitCode).toBeNull();
      expect(Array.isArray(parsed.filesChanged)).toBe(true);
      expect(typeof parsed.diffstat).toBe("string");
    } finally {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  it("produces valid JSON with empty filesChanged when not a git repo", () => {
    const testDir = tmpDir();
    try {
      process.chdir(testDir);

      const git = defaultGitRunner();
      const result = buildSummary(
        {
          runId: "test-run-456",
          agent: "mm-code",
          tier: 2,
          status: "failed" as const,
          exitCode: 1,
          durationMs: 1200,
          cwd: testDir,
          verifyRan: true,
          verifyExitCode: 0,
        },
        git,
      );

      const parsed = JSON.parse(result);
      expect(parsed.filesChanged).toEqual([]);
      expect(parsed.diffstat).toBe("");
      expect(parsed.verify.ran).toBe(true);
      expect(parsed.verify.exitCode).toBe(0);
    } finally {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  it("includes git diffstat output when git diff produces shortstat", () => {
    const testDir = tmpDir();
    try {
      process.chdir(testDir);
      execSync("git init", { stdio: "ignore" });
      execSync("git config user.name 'Test User'", { stdio: "ignore" });
      execSync("git config user.email 'test@example.com'", { stdio: "ignore" });
      fs.mkdirSync("subdir", { recursive: true });
      fs.writeFileSync("subdir/file.txt", "content");
      execSync("git add .", { stdio: "ignore" });
      execSync("git commit -m 'initial'", { stdio: "ignore" });

      // Make a change
      fs.writeFileSync("subdir/file.txt", "changed content");

      const git = defaultGitRunner();
      const result = buildSummary(
        {
          runId: "test-run-789",
          agent: "qwen",
          tier: 3,
          status: "done" as const,
          exitCode: 0,
          durationMs: 5000,
          cwd: testDir,
          verifyRan: false,
          verifyExitCode: null,
        },
        git,
      );

      const parsed = JSON.parse(result);
      expect(parsed.diffstat).toContain("file");
      expect(parsed.diffstat).toContain("change");
    } finally {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  it("outputs JSON line with no extra content before or after", () => {
    const testDir = tmpDir();
    try {
      process.chdir(testDir);
      fs.writeFileSync("a.txt", "");

      const git = defaultGitRunner();
      const result = buildSummary(
        {
          runId: "line-test",
          agent: "kilo",
          tier: 1,
          status: "done" as const,
          exitCode: 0,
          durationMs: 100,
          cwd: testDir,
          verifyRan: false,
          verifyExitCode: null,
        },
        git,
      );

      // The result should be a pure JSON line - nothing else
      expect(result).toMatch(/^\{"runId"/);
      expect(result).toMatch(/}$/);
      // No trailing newline or extra characters
      expect(result).not.toContain("\n");
    } finally {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });
});
