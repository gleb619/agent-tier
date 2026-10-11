import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Command } from "commander";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { registerFeedbackCommand } from "../../src/commands/feedback";
import { type RunRecord, saveRuns } from "../../src/run-store";

function makeProgram(): Command {
  const program = new Command();
  program.name("at");
  program.exitOverride();
  registerFeedbackCommand(program);
  return program;
}

describe("feedback command", () => {
  let stateDir: string;
  let originalStateDir: string | undefined;

  beforeEach(() => {
    originalStateDir = process.env.AT_STATE_DIR;
    stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "at-feedback-cmd-"));
    process.env.AT_STATE_DIR = stateDir;
    fs.writeFileSync(path.join(stateDir, "state.json"), "{}", "utf8");
  });

  afterEach(() => {
    fs.rmSync(stateDir, { recursive: true, force: true });
    if (originalStateDir !== undefined) {
      process.env.AT_STATE_DIR = originalStateDir;
    } else {
      delete process.env.AT_STATE_DIR;
    }
    vi.restoreAllMocks();
  });

  it("adds feedback and prints id", async () => {
    const program = makeProgram();
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await program.parseAsync(["node", "at", "feedback", "add", "hello world"]);

    expect(logSpy).toHaveBeenCalledWith(expect.stringMatching(/\[at\] feedback [a-f0-9]{8} added/));
  });

  it("auto-fills agent/tier from run id", async () => {
    const run: RunRecord = {
      runId: "run-abc-123",
      agent: "kimi",
      tier: 1,
      pid: 123,
      prompt: "p",
      logFile: "/tmp/at.log",
      startedAt: new Date().toISOString(),
      finishedAt: null,
      exitCode: null,
      status: "running",
      name: "unnamed",
    };
    saveRuns(stateDir, [run]);

    const program = makeProgram();
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await program.parseAsync(["node", "at", "feedback", "add", "run bug", "-r", "run-abc", "-k", "bug"]);

    expect(logSpy).toHaveBeenCalledWith(expect.stringMatching(/\[at\] feedback [a-f0-9]{8} added/));
  });

  it("lists feedback in human format", async () => {
    const program = makeProgram();
    await program.parseAsync(["node", "at", "feedback", "add", "first note"]);
    await program.parseAsync(["node", "at", "feedback", "add", "second note"]);

    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    await program.parseAsync(["node", "at", "feedback", "list"]);

    const lines = logSpy.mock.calls.map((c) => c[0] as string);
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain("second note");
    expect(lines[1]).toContain("first note");
  });

  it("lists feedback as json", async () => {
    const program = makeProgram();
    await program.parseAsync(["node", "at", "feedback", "add", "json note"]);

    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    await program.parseAsync(["node", "at", "feedback", "list", "--json"]);

    const output = logSpy.mock.calls[0][0] as string;
    const parsed = JSON.parse(output);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].text).toBe("json note");
  });

  it("shows a single entry by prefix", async () => {
    const program = makeProgram();
    const logSpy1 = vi.spyOn(console, "log").mockImplementation(() => {});
    await program.parseAsync(["node", "at", "feedback", "add", "show me"]);
    const addLine = logSpy1.mock.calls[0][0] as string;
    const id = addLine.match(/[a-f0-9]{8}/)![0];
    logSpy1.mockClear();

    const logSpy2 = vi.spyOn(console, "log").mockImplementation(() => {});
    await program.parseAsync(["node", "at", "feedback", "show", id.slice(0, 4)]);

    const output = logSpy2.mock.calls.map((c) => c[0]).join("\n");
    expect(output).toContain("show me");
    expect(output).toContain(`id:        ${id}`);
  });

  it("updates text and status", async () => {
    const program = makeProgram();
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    await program.parseAsync(["node", "at", "feedback", "add", "original"]);
    const id = (logSpy.mock.calls[0][0] as string).match(/[a-f0-9]{8}/)![0];
    logSpy.mockClear();

    await program.parseAsync([
      "node",
      "at",
      "feedback",
      "update",
      id,
      "--text",
      "updated text",
      "--status",
      "resolved",
    ]);

    expect(logSpy).toHaveBeenCalledWith(`[at] feedback ${id} updated`);

    logSpy.mockClear();
    await program.parseAsync(["node", "at", "feedback", "show", id, "--json"]);
    const entry = JSON.parse(logSpy.mock.calls[0][0] as string);
    expect(entry.text).toBe("updated text");
    expect(entry.status).toBe("resolved");
    expect(entry.resolvedAt).toBeDefined();
  });

  it("resolve marks as resolved", async () => {
    const program = makeProgram();
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    await program.parseAsync(["node", "at", "feedback", "add", "resolve me"]);
    const id = (logSpy.mock.calls[0][0] as string).match(/[a-f0-9]{8}/)![0];
    logSpy.mockClear();

    await program.parseAsync(["node", "at", "feedback", "resolve", id]);
    expect(logSpy).toHaveBeenCalledWith(`[at] feedback ${id} resolved`);

    logSpy.mockClear();
    await program.parseAsync(["node", "at", "feedback", "resolve", id, "--wontfix"]);
    expect(logSpy).toHaveBeenCalledWith(`[at] feedback ${id} wontfix`);
  });

  it("removes entries by id", async () => {
    const program = makeProgram();
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    await program.parseAsync(["node", "at", "feedback", "add", "remove me"]);
    const id = (logSpy.mock.calls[0][0] as string).match(/[a-f0-9]{8}/)![0];
    logSpy.mockClear();

    await program.parseAsync(["node", "at", "feedback", "rm", id]);
    expect(logSpy).toHaveBeenCalledWith("[at] feedback: removed 1 entries");
  });

  it("clears resolved entries", async () => {
    const program = makeProgram();
    await program.parseAsync(["node", "at", "feedback", "add", "open entry"]);
    await program.parseAsync(["node", "at", "feedback", "add", "closed entry"]);
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    await program.parseAsync(["node", "at", "feedback", "list", "--json"]);
    const entries = JSON.parse(logSpy.mock.calls[0][0] as string);
    const closedId = entries.find((e: { text: string }) => e.text === "closed entry").id;
    logSpy.mockClear();

    await program.parseAsync(["node", "at", "feedback", "resolve", closedId]);
    logSpy.mockClear();

    await program.parseAsync(["node", "at", "feedback", "clear", "--resolved"]);
    expect(logSpy).toHaveBeenCalledWith("[at] feedback: cleared 1 entries");
  });

  it("clear --all requires --yes", async () => {
    const program = makeProgram();
    const exitSpy = vi.spyOn(process, "exit").mockImplementation((code) => {
      throw new Error(`exit ${code}`);
    });
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    await program.parseAsync(["node", "at", "feedback", "add", "x"]);

    await expect(program.parseAsync(["node", "at", "feedback", "clear", "--all"])).rejects.toThrow("exit 1");

    expect(errSpy).toHaveBeenCalledWith(expect.stringContaining("--yes is required"));
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it("prune prints evicted count", async () => {
    fs.writeFileSync(path.join(stateDir, "state.json"), JSON.stringify({ feedback: { maxEntries: 1 } }), "utf8");
    const program = makeProgram();
    await program.parseAsync(["node", "at", "feedback", "add", "old"]);

    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    await program.parseAsync(["node", "at", "feedback", "add", "new"]);
    await program.parseAsync(["node", "at", "feedback", "prune"]);

    const pruneLine = logSpy.mock.calls.find(
      (c) => typeof c[0] === "string" && c[0].startsWith("[at] feedback: pruned"),
    );
    expect(pruneLine).toBeDefined();
  });

  it("errors on missing id", async () => {
    const program = makeProgram();
    const exitSpy = vi.spyOn(process, "exit").mockImplementation((code) => {
      throw new Error(`exit ${code}`);
    });
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(program.parseAsync(["node", "at", "feedback", "show", "00000000"])).rejects.toThrow("exit 1");

    expect(errSpy).toHaveBeenCalledWith(expect.stringContaining("not found"));
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it("errors on invalid text length", async () => {
    const program = makeProgram();
    const _exitSpy = vi.spyOn(process, "exit").mockImplementation((code) => {
      throw new Error(`exit ${code}`);
    });
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(program.parseAsync(["node", "at", "feedback", "add", "x".repeat(4001)])).rejects.toThrow("exit 1");

    expect(errSpy).toHaveBeenCalledWith(expect.stringContaining("exceeds 4000"));
  });
});
