import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Command } from "commander";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { registerDiscussCommand } from "../../src/commands/discuss";
import { appendDiscuss, nextDiscussId, readThread } from "../../src/notify/discuss-store";
import { startHub } from "../../src/notify/hub";

describe("at discuss command", () => {
  let tmp: string;
  let stateDir: string;
  let hub: Awaited<ReturnType<typeof startHub>> | undefined;
  // Mock process.exit: re-throw for non-zero (lets tests assert exit code),
  // pass through for zero (so success paths complete normally).
  const exitSpy = vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
    if (code && code !== 0) throw new Error(`__exit__:${code}`);
    return undefined as never;
  }) as never);
  const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

  beforeEach(() => {
    tmp = mkdtempSync(path.join(tmpdir(), "at-discuss-"));
    stateDir = tmp;
    exitSpy.mockClear();
    logSpy.mockClear();
    errSpy.mockClear();
    process.env.AT_STATE_DIR = stateDir;
  });

  afterEach(async () => {
    await hub?.close();
    delete process.env.AT_SSE_URL;
    delete process.env.AT_STATE_DIR;
    rmSync(tmp, { recursive: true, force: true });
  });

  async function runDiscuss(args: string[]): Promise<void> {
    const program = new Command();
    // Mirror the root-level options that shadow discuss subcommand options
    // in the real CLI (e.g. --json, --state-dir) without pulling in unrelated
    // defaults like --timeout that conflict with ask's own --timeout.
    program.option("--state-dir <path>", "State directory");
    program.option("--json", "Read JSON from stdin", false);
    program.option("--retries <number>", "Retries", "0");
    registerDiscussCommand(program);
    await program.parseAsync(["node", "at", "discuss", ...args]);
  }

  // ── ask ───────────────────────────────────────────────────────────────────

  it("ask blocks then returns on answer written to file", async () => {
    process.env.AT_RUN_ID = "r-ask-file";
    // Schedule the answer to appear ~150ms after ask starts polling.
    setTimeout(() => {
      const stateDir2 = process.env.AT_STATE_DIR!;
      const id = nextDiscussId(stateDir2, "r-ask-file");
      appendDiscuss(stateDir2, "r-ask-file", {
        id,
        from: "host",
        kind: "answer",
        text: "go-ahead",
        replyTo: "m1",
        ts: new Date().toISOString(),
      });
    }, 150);

    const stdoutChunks: string[] = [];
    const origWrite = process.stdout.write.bind(process.stdout);
    (process.stdout.write as unknown) = (s: string | Buffer): boolean => {
      stdoutChunks.push(String(s));
      return true;
    };
    try {
      await runDiscuss(["ask", "continue?", "--timeout", "5"]);
    } finally {
      (process.stdout.write as unknown) = origWrite;
    }
    expect(stdoutChunks.join("")).toContain("go-ahead");
  });

  it("ask POSTs to hub and blocks for hub-broadcast answer", async () => {
    hub = await startHub({ stateDir, port: 0 });
    process.env.AT_SSE_URL = `http://127.0.0.1:${hub.port}`;
    process.env.AT_RUN_ID = "r-ask-hub";

    // After ~200ms, the agent's hub-side answer would be POSTed. We POST it
    // from here via the hub's /discuss endpoint so the file gets the entry.
    setTimeout(async () => {
      await fetch(`http://127.0.0.1:${hub!.port}/discuss/r-ask-hub`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ from: "host", kind: "answer", text: "yes", replyTo: "m1" }),
      });
    }, 200);

    const stdoutChunks: string[] = [];
    const origWrite = process.stdout.write.bind(process.stdout);
    (process.stdout.write as unknown) = (s: string | Buffer): boolean => {
      stdoutChunks.push(String(s));
      return true;
    };
    try {
      await runDiscuss(["ask", "ship it?", "--timeout", "5"]);
    } finally {
      (process.stdout.write as unknown) = origWrite;
    }
    expect(stdoutChunks.join("")).toContain("yes");
  });

  it("ask prints --default and exits 0 on timeout", async () => {
    process.env.AT_RUN_ID = "r-default";
    const stdoutChunks: string[] = [];
    const origWrite = process.stdout.write.bind(process.stdout);
    (process.stdout.write as unknown) = (s: string | Buffer): boolean => {
      stdoutChunks.push(String(s));
      return true;
    };
    try {
      await runDiscuss(["ask", "?", "--timeout", "1", "--default", "fallback"]);
    } catch (_e) {
      // no exit, command completes normally with --default
    } finally {
      (process.stdout.write as unknown) = origWrite;
    }
    expect(stdoutChunks.join("")).toContain("fallback");
  });

  it("ask exits 2 on timeout when no --default", async () => {
    process.env.AT_RUN_ID = "r-timeout";
    let exitCode: number | undefined;
    const trap = vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
      exitCode = code;
      throw new Error(`__exit__:${code}`);
    }) as never);
    try {
      try {
        await runDiscuss(["ask", "?", "--timeout", "1"]);
      } catch (_e) {
        // expected
      }
    } finally {
      trap.mockRestore();
    }
    expect(exitCode).toBe(2);
  });

  // ── note + inbox + say ─────────────────────────────────────────────────────

  it("note appends a kind:note entry and say appends kind:say", async () => {
    process.env.AT_RUN_ID = "r-note-say";
    await runDiscuss(["note", "milestone reached"]);
    await runDiscuss(["say", "do the next thing"]);
    const entries = readThread(stateDir, "r-note-say");
    expect(entries.find((e) => e.kind === "note" && e.text === "milestone reached")).toBeDefined();
    expect(entries.find((e) => e.kind === "say" && e.text === "do the next thing")).toBeDefined();
  });

  it("inbox returns host says; --wait polls for new ones", async () => {
    process.env.AT_RUN_ID = "r-inbox";
    await runDiscuss(["say", "first instruction"]);
    await new Promise((r) => setTimeout(r, 50));
    setTimeout(() => {
      void runDiscuss(["say", "second instruction"]);
    }, 200);

    const stdoutChunks: string[] = [];
    const origWrite = process.stdout.write.bind(process.stdout);
    (process.stdout.write as unknown) = (s: string | Buffer): boolean => {
      stdoutChunks.push(String(s));
      return true;
    };
    try {
      await runDiscuss(["inbox", "--wait", "2"]);
    } finally {
      (process.stdout.write as unknown) = origWrite;
    }
    const out = stdoutChunks.join("");
    expect(out).toContain("first instruction");
    expect(out).toContain("second instruction");
  });

  // ── list --pending ────────────────────────────────────────────────────────

  it("list --pending shows only unanswered questions", async () => {
    process.env.AT_RUN_ID = "r-list";
    await runDiscuss(["ask", "q1?", "--timeout", "1", "--default", "d1"]);
    await runDiscuss(["ask", "q2?", "--timeout", "1", "--default", "d2"]);
    // both answered → should not appear under --pending; j1 may remain unanswered if we cancel early
    const stdoutChunks: string[] = [];
    const origWrite = process.stdout.write.bind(process.stdout);
    (process.stdout.write as unknown) = (s: string | Buffer): boolean => {
      stdoutChunks.push(String(s));
      return true;
    };
    try {
      await runDiscuss(["list", "--pending"]);
    } finally {
      (process.stdout.write as unknown) = origWrite;
    }
    // With both having --default, they auto-answer and --pending returns nothing.
    expect(stdoutChunks.join("").trim()).toBe("");
  });

  it("list --json emits JSON", async () => {
    process.env.AT_RUN_ID = "r-json";
    await runDiscuss(["note", "hello"]);
    const stdoutChunks: string[] = [];
    const origWrite = process.stdout.write.bind(process.stdout);
    (process.stdout.write as unknown) = (s: string | Buffer): boolean => {
      stdoutChunks.push(String(s));
      return true;
    };
    try {
      await runDiscuss(["list", "--json"]);
    } finally {
      (process.stdout.write as unknown) = origWrite;
    }
    const parsed = JSON.parse(stdoutChunks.join(""));
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed[0]).toMatchObject({ kind: "note", text: "hello" });
  });

  // ── answer ────────────────────────────────────────────────────────────────

  it("answer writes an answer entry", async () => {
    process.env.AT_RUN_ID = "r-answer";
    // Seed a question
    appendDiscuss(stateDir, "r-answer", {
      id: "m1",
      from: "agent",
      kind: "question",
      text: "go?",
      ts: new Date().toISOString(),
    });
    await runDiscuss(["answer", "m1", "yes"]);
    const entries = readThread(stateDir, "r-answer");
    const ans = entries.find((e) => e.kind === "answer");
    expect(ans).toBeDefined();
    expect(ans?.replyTo).toBe("m1");
    expect(ans?.text).toBe("yes");
  });

  // ── watch non-TTY ─────────────────────────────────────────────────────────

  it("watch (non-TTY) prints existing then new entries", async () => {
    process.env.AT_RUN_ID = "r-watch";
    // Seed initial entry
    await runDiscuss(["note", "init"]);
    const stdoutChunks: string[] = [];
    const origWrite = process.stdout.write.bind(process.stdout);
    (process.stdout.write as unknown) = (s: string | Buffer): boolean => {
      stdoutChunks.push(String(s));
      return true;
    };

    // schedule a new entry ~150ms in (write directly to the file to avoid
    // spinning up another commander parse, which would never resolve under
    // our process.exit spy)
    setTimeout(() => {
      const stateDir2 = process.env.AT_STATE_DIR!;
      appendDiscuss(stateDir2, "r-watch", {
        id: nextDiscussId(stateDir2, "r-watch"),
        from: "agent",
        kind: "note",
        text: "followup",
        ts: new Date().toISOString(),
      });
    }, 150);

    // Start watch (parseAsync will not resolve until SIGINT; SIGINT triggers
    // process.exit which our spy treats as no-op for code 0). Use a hard
    // deadline to stop the test.
    const stopAfter = setTimeout(() => process.kill(process.pid, "SIGINT"), 800);
    try {
      await runDiscuss(["watch", "--interval", "50"]);
    } catch {
      // expected: SIGINT handler exits, spy swallows it
    } finally {
      clearTimeout(stopAfter);
      (process.stdout.write as unknown) = origWrite;
    }
    const out = stdoutChunks.join("");
    expect(out).toContain("followup");
  });
  // ── --state-dir flag (regression) ─────────────────────────────────────────

  it("list --pending --json reads from --state-dir even after subcommand", async () => {
    // Use a separate directory and clear the env override so we know the
    // option is driving resolution.
    const altState = mkdtempSync(path.join(tmpdir(), "at-discuss-alt-"));
    delete process.env.AT_STATE_DIR;
    appendDiscuss(altState, "r-alt", {
      id: "m1",
      from: "agent",
      kind: "question",
      text: "q?",
      ts: new Date().toISOString(),
    });

    const stdoutChunks: string[] = [];
    const origWrite = process.stdout.write.bind(process.stdout);
    (process.stdout.write as unknown) = (s: string | Buffer): boolean => {
      stdoutChunks.push(String(s));
      return true;
    };
    try {
      await runDiscuss(["list", "r-alt", "--pending", "--json", "--state-dir", altState]);
    } finally {
      (process.stdout.write as unknown) = origWrite;
      rmSync(altState, { recursive: true, force: true });
    }
    const parsed = JSON.parse(stdoutChunks.join(""));
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed).toHaveLength(1);
    expect(parsed[0]).toMatchObject({ kind: "question", text: "q?" });
  });

  it("answer uses -R/--run and defaults to latest unanswered", async () => {
    process.env.AT_RUN_ID = "r-answer-run";
    appendDiscuss(stateDir, "r-answer-run", {
      id: "m1",
      from: "agent",
      kind: "question",
      text: "go?",
      ts: new Date().toISOString(),
    });
    await runDiscuss(["answer", "yes", "-R", "r-answer-run"]);
    const entries = readThread(stateDir, "r-answer-run");
    const ans = entries.find((e) => e.kind === "answer");
    expect(ans).toBeDefined();
    expect(ans?.replyTo).toBe("m1");
    expect(ans?.text).toBe("yes");
  });

  it("answer treats first mN positional as qid", async () => {
    process.env.AT_RUN_ID = "r-answer-qid";
    appendDiscuss(stateDir, "r-answer-qid", {
      id: "m1",
      from: "agent",
      kind: "question",
      text: "q1?",
      ts: new Date().toISOString(),
    });
    appendDiscuss(stateDir, "r-answer-qid", {
      id: "m2",
      from: "agent",
      kind: "question",
      text: "q2?",
      ts: new Date().toISOString(),
    });
    await runDiscuss(["answer", "m2", "answer-two"]);
    const entries = readThread(stateDir, "r-answer-qid");
    const ans = entries.find((e) => e.kind === "answer" && e.replyTo === "m2");
    expect(ans).toBeDefined();
    expect(ans?.text).toBe("answer-two");
  });

  it("answer accepts --qid to override latest unanswered", async () => {
    process.env.AT_RUN_ID = "r-answer-qid-opt";
    appendDiscuss(stateDir, "r-answer-qid-opt", {
      id: "m1",
      from: "agent",
      kind: "question",
      text: "q1?",
      ts: new Date().toISOString(),
    });
    appendDiscuss(stateDir, "r-answer-qid-opt", {
      id: "m2",
      from: "agent",
      kind: "question",
      text: "q2?",
      ts: new Date().toISOString(),
    });
    await runDiscuss(["answer", "--qid", "m1", "answer-one"]);
    const entries = readThread(stateDir, "r-answer-qid-opt");
    const ans = entries.find((e) => e.kind === "answer" && e.replyTo === "m1");
    expect(ans).toBeDefined();
    expect(ans?.text).toBe("answer-one");
  });

  it("answer accepts -R/--run and --state-dir D", async () => {
    const altState = mkdtempSync(path.join(tmpdir(), "at-discuss-R-"));
    delete process.env.AT_RUN_ID;
    delete process.env.AT_STATE_DIR;
    appendDiscuss(altState, "r-R", {
      id: "m1",
      from: "agent",
      kind: "question",
      text: "go?",
      ts: new Date().toISOString(),
    });

    await runDiscuss(["answer", "yes", "-R", "r-R", "--state-dir", altState]);
    const entries = readThread(altState, "r-R");
    const ans = entries.find((e) => e.kind === "answer");
    expect(ans).toBeDefined();
    expect(ans?.replyTo).toBe("m1");
    expect(ans?.text).toBe("yes");
    rmSync(altState, { recursive: true, force: true });
  });

  it("answer accepts -R/--run and --state-dir D", async () => {
    const altState = mkdtempSync(path.join(tmpdir(), "at-discuss-R-"));
    delete process.env.AT_RUN_ID;
    delete process.env.AT_STATE_DIR;
    appendDiscuss(altState, "r-R", {
      id: "m1",
      from: "agent",
      kind: "question",
      text: "go?",
      ts: new Date().toISOString(),
    });

    await runDiscuss(["answer", "yes", "-R", "r-R", "--state-dir", altState]);
    const entries = readThread(altState, "r-R");
    const ans = entries.find((e) => e.kind === "answer");
    expect(ans).toBeDefined();
    expect(ans?.replyTo).toBe("m1");
    expect(ans?.text).toBe("yes");
    rmSync(altState, { recursive: true, force: true });
  });
});
