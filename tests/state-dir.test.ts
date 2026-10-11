import * as fs from "node:fs";
import os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  findProjectRoot,
  getRunsFilePath,
  getStateFilePath,
  resolveFeedbackDir,
  resolveStateDir,
} from "../src/state-dir";

describe("getStateFilePath", () => {
  it("joins stateDir with state.json", () => {
    expect(getStateFilePath("/home/user/.at")).toBe("/home/user/.at/state.json");
  });
});

describe("getRunsFilePath", () => {
  it("joins stateDir with runs.jsonl", () => {
    expect(getRunsFilePath("/home/user/.at")).toBe("/home/user/.at/runs.jsonl");
  });
});

describe("resolveStateDir", () => {
  let tmpDir: string;
  let savedStateDir: string | undefined;

  beforeEach(() => {
    savedStateDir = process.env.AT_STATE_DIR;
    delete process.env.AT_STATE_DIR;
    tmpDir = path.join(os.tmpdir(), `at-state-dir-test-${Date.now()}`);
  });

  afterEach(() => {
    if (fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
    if (savedStateDir !== undefined) {
      process.env.AT_STATE_DIR = savedStateDir;
    } else {
      delete process.env.AT_STATE_DIR;
    }
  });

  it("returns explicit path unchanged", () => {
    expect(resolveStateDir("/explicit/path")).toBe("/explicit/path");
    expect(resolveStateDir("/another/path")).toBe("/another/path");
  });

  it("defaults to ~/.at/ when no .at/ in cwd", () => {
    vi.spyOn(process, "cwd").mockReturnValue(tmpDir);
    expect(resolveStateDir()).toBe(path.join(os.homedir(), ".at"));
  });

  it("detects .at/state.json in cwd and returns it", () => {
    const atDir = path.join(tmpDir, ".at");
    fs.mkdirSync(atDir, { recursive: true });
    fs.writeFileSync(path.join(atDir, "state.json"), "{}");
    vi.spyOn(process, "cwd").mockReturnValue(tmpDir);
    expect(resolveStateDir()).toBe(atDir);
  });

  it("detects .at/runs.jsonl in cwd and returns it", () => {
    const atDir = path.join(tmpDir, ".at");
    fs.mkdirSync(atDir, { recursive: true });
    fs.writeFileSync(path.join(atDir, "runs.jsonl"), "");
    vi.spyOn(process, "cwd").mockReturnValue(tmpDir);
    expect(resolveStateDir()).toBe(atDir);
  });

  it("detects .at/ in project root when CWD is subdirectory", () => {
    const projectRoot = path.join(os.tmpdir(), `at-project-root-${Date.now()}`);
    const subDir = path.join(projectRoot, "packages", "lib");
    const atDir = path.join(projectRoot, ".at");
    fs.mkdirSync(atDir, { recursive: true });
    fs.writeFileSync(path.join(atDir, "state.json"), "{}");
    fs.mkdirSync(path.join(projectRoot, ".git"), { recursive: true });
    fs.mkdirSync(subDir, { recursive: true });

    vi.spyOn(process, "cwd").mockReturnValue(subDir);
    expect(resolveStateDir()).toBe(atDir);

    fs.rmSync(projectRoot, { recursive: true, force: true });
  });
});

describe("resolveFeedbackDir", () => {
  let tmpDir: string;
  let savedStateDir: string | undefined;

  beforeEach(() => {
    savedStateDir = process.env.AT_STATE_DIR;
    delete process.env.AT_STATE_DIR;
    tmpDir = path.join(os.tmpdir(), `at-feedback-dir-test-${Date.now()}`);
  });

  afterEach(() => {
    if (fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
    if (savedStateDir !== undefined) {
      process.env.AT_STATE_DIR = savedStateDir;
    } else {
      delete process.env.AT_STATE_DIR;
    }
    vi.restoreAllMocks();
  });

  it("returns explicit path unchanged", () => {
    expect(resolveFeedbackDir("/explicit/path")).toBe("/explicit/path");
  });

  it("honors AT_STATE_DIR override", () => {
    process.env.AT_STATE_DIR = "/tmp/at-override";
    expect(resolveFeedbackDir()).toBe("/tmp/at-override");
  });

  it("falls back to ~/.at/ when project .at/ has no feedback.jsonl", () => {
    const projectRoot = path.join(os.tmpdir(), `at-feedback-root-${Date.now()}`);
    const subDir = path.join(projectRoot, "packages", "lib");
    const atDir = path.join(projectRoot, ".at");
    fs.mkdirSync(atDir, { recursive: true });
    fs.writeFileSync(path.join(atDir, "state.json"), "{}");
    fs.writeFileSync(path.join(atDir, "runs.jsonl"), "");
    fs.mkdirSync(path.join(projectRoot, ".git"), { recursive: true });
    fs.mkdirSync(subDir, { recursive: true });

    vi.spyOn(process, "cwd").mockReturnValue(subDir);
    // sanity: regular resolution IS shadowed by the project .at/
    expect(resolveStateDir()).toBe(atDir);
    // feedback is not — no feedback.jsonl there, so queue stays global
    expect(resolveFeedbackDir()).toBe(path.join(os.homedir(), ".at"));

    fs.rmSync(projectRoot, { recursive: true, force: true });
  });

  it("prefers project .at/ when it contains feedback.jsonl", () => {
    const projectRoot = path.join(os.tmpdir(), `at-feedback-local-${Date.now()}`);
    const subDir = path.join(projectRoot, "packages", "lib");
    const atDir = path.join(projectRoot, ".at");
    fs.mkdirSync(atDir, { recursive: true });
    fs.writeFileSync(path.join(atDir, "feedback.jsonl"), "");
    fs.mkdirSync(path.join(projectRoot, ".git"), { recursive: true });
    fs.mkdirSync(subDir, { recursive: true });

    vi.spyOn(process, "cwd").mockReturnValue(subDir);
    expect(resolveFeedbackDir()).toBe(atDir);

    fs.rmSync(projectRoot, { recursive: true, force: true });
  });

  it("detects .at/feedback.jsonl in cwd (no git root)", () => {
    const atDir = path.join(tmpDir, ".at");
    fs.mkdirSync(atDir, { recursive: true });
    fs.writeFileSync(path.join(atDir, "feedback.jsonl"), "");
    vi.spyOn(process, "cwd").mockReturnValue(tmpDir);
    expect(resolveFeedbackDir()).toBe(atDir);
  });
});

describe("findProjectRoot", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = path.join(os.tmpdir(), `at-find-root-test-${Date.now()}`);
  });

  afterEach(() => {
    if (fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("returns undefined when no .git found", () => {
    fs.mkdirSync(tmpDir, { recursive: true });
    expect(findProjectRoot(tmpDir)).toBeUndefined();
  });

  it("finds .git in start dir", () => {
    fs.mkdirSync(path.join(tmpDir, ".git"), { recursive: true });
    expect(findProjectRoot(tmpDir)).toBe(tmpDir);
  });

  it("walks up to find .git in parent", () => {
    const subDir = path.join(tmpDir, "sub", "dir");
    fs.mkdirSync(path.join(tmpDir, ".git"), { recursive: true });
    fs.mkdirSync(subDir, { recursive: true });
    expect(findProjectRoot(subDir)).toBe(tmpDir);
  });
});
