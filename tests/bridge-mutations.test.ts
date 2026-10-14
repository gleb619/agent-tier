/**
 * T28: `at bridge` mutation verbs — runs stop/stop-all, feedback add|update|resolve|rm,
 * kanban add|status|remove, line add|rm|move. Contract: docs/bridge.md.
 * Isolation: AT_STATE_DIR (runs/feedback), AT_KANBAN_FILE (board), AT_CONFIG_DIR (line).
 */

import { type ChildProcess, execSync, spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { computeHmac } from "../src/config";
import { getLockDir, pathToLockName } from "../src/lock";
import { getRunsFile, type RunRecord } from "../src/run-store";

const cliPath = path.join(__dirname, "..", "dist", "cli.js");

function buildCli(): void {
  execSync("npm run build", { stdio: "inherit" });
}

interface CliResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

function runBridge(args: string[], stdin: string, env: Record<string, string>): CliResult {
  const result = spawnSync("node", [cliPath, ...args], {
    encoding: "utf8",
    input: stdin,
    env: { ...process.env, ...env },
  });
  return {
    exitCode: result.status ?? -1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

function runCli(args: string[], env: Record<string, string>): CliResult {
  const result = spawnSync("node", [cliPath, ...args], {
    encoding: "utf8",
    env: { ...process.env, ...env },
  });
  return {
    exitCode: result.status ?? -1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

function seedStateDir(stateDir: string): void {
  mkdirSync(stateDir, { recursive: true });
  writeFileSync(path.join(stateDir, "state.json"), "{}", "utf8");
}

function makeRun(runId: string, pid: number, startedAt: string): RunRecord {
  return {
    runId,
    agent: "mock",
    tier: 4,
    pid,
    prompt: "noop",
    logFile: "/tmp/noop.log",
    startedAt,
    finishedAt: null,
    exitCode: null,
    status: "running",
    name: "unnamed",
  };
}

/** Detached live process (own group, so `stopRun`'s -pid kill works like a real run). */
function spawnSleeper(): ChildProcess {
  const child = spawn("node", ["-e", "setInterval(() => {}, 1000)"], { detached: true, stdio: "ignore" });
  child.unref();
  if (!child.pid) throw new Error("failed to spawn sleeper");
  return child;
}

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** SIGTERM teardown is async — poll instead of asserting immediately after the call. */
async function waitForDead(pid: number, timeoutMs = 5000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!pidAlive(pid)) return true;
    await new Promise((r) => setTimeout(r, 100));
  }
  return !pidAlive(pid);
}

const sleepers: ChildProcess[] = [];

function track(child: ChildProcess): ChildProcess {
  sleepers.push(child);
  return child;
}

afterAll(() => {
  for (const child of sleepers) {
    if (child.pid && pidAlive(child.pid)) {
      try {
        process.kill(child.pid, "SIGKILL");
      } catch {
        // already gone
      }
    }
  }
});

describe("at bridge — mutation verbs (T28)", () => {
  beforeAll(() => {
    buildCli();
  }, 120000);

  describe("runs", () => {
    it("stop unknown id → exit 3 NOT_FOUND", () => {
      const stateDir = mkdtempSync(path.join(os.tmpdir(), "at-bridge-stop-"));
      seedStateDir(stateDir);
      try {
        const r = runBridge(["bridge", "runs", "stop"], JSON.stringify({ id: "nope" }), {
          AT_STATE_DIR: stateDir,
        });
        expect(r.exitCode).toBe(3);
        const out = JSON.parse(r.stdout);
        expect(out.error.code).toBe("NOT_FOUND");
        expect(out.error.message).toContain("nope");
      } finally {
        rmSync(stateDir, { recursive: true, force: true });
      }
    });

    it("stop with no running runs → exit 3 NOT_FOUND", () => {
      const stateDir = mkdtempSync(path.join(os.tmpdir(), "at-bridge-stopnone-"));
      seedStateDir(stateDir);
      try {
        const r = runBridge(["bridge", "runs", "stop"], "{}", { AT_STATE_DIR: stateDir });
        expect(r.exitCode).toBe(3);
        expect(JSON.parse(r.stdout).error.code).toBe("NOT_FOUND");
      } finally {
        rmSync(stateDir, { recursive: true, force: true });
      }
    });

    it("stop signals a live detached process and marks the run failed", async () => {
      const stateDir = mkdtempSync(path.join(os.tmpdir(), "at-bridge-stoplive-"));
      seedStateDir(stateDir);
      const child = track(spawnSleeper());
      const run = makeRun("deadbeefcafe", child.pid as number, new Date().toISOString());
      writeFileSync(getRunsFile(stateDir), `${JSON.stringify(run)}\n`, "utf8");
      try {
        const r = runBridge(["bridge", "runs", "stop"], JSON.stringify({ id: "deadbeef" }), {
          AT_STATE_DIR: stateDir,
        });
        expect(r.exitCode).toBe(0);
        const out = JSON.parse(r.stdout);
        expect(out.ok).toBe(true);
        expect(out.data.runId).toBe("deadbeefcafe");
        expect(out.data.stopped).toBe(true);
        // stdout stays a single JSON line
        expect(r.stdout.trim().split("\n").length).toBe(1);
        // process group is gone
        expect(await waitForDead(child.pid as number)).toBe(true);
        // run record marked failed
        const updated = readFileSync(getRunsFile(stateDir), "utf8")
          .trim()
          .split("\n")
          .map((l) => JSON.parse(l) as RunRecord);
        expect(updated[0].status).toBe("failed");
        expect(updated[0].finishedAt).not.toBeNull();
      } finally {
        rmSync(stateDir, { recursive: true, force: true });
      }
    });

    it("stop-all stops every running run", async () => {
      const stateDir = mkdtempSync(path.join(os.tmpdir(), "at-bridge-stopall-"));
      seedStateDir(stateDir);
      const c1 = track(spawnSleeper());
      const c2 = track(spawnSleeper());
      const now = Date.now();
      writeFileSync(
        getRunsFile(stateDir),
        `${[
          JSON.stringify(makeRun("run111111111", c1.pid as number, new Date(now - 2000).toISOString())),
          JSON.stringify(makeRun("run222222222", c2.pid as number, new Date(now - 1000).toISOString())),
          JSON.stringify({ ...makeRun("already-done", 1, new Date(now - 3000).toISOString()), status: "done" }),
        ].join("\n")}\n`,
        "utf8",
      );
      try {
        const r = runBridge(["bridge", "runs", "stop-all"], "{}", { AT_STATE_DIR: stateDir });
        expect(r.exitCode).toBe(0);
        const out = JSON.parse(r.stdout);
        expect(out.ok).toBe(true);
        expect(out.data.stopped.sort()).toEqual(["run111111111", "run222222222"]);
        expect(out.data.errors).toEqual([]);
        expect(await waitForDead(c1.pid as number)).toBe(true);
        expect(await waitForDead(c2.pid as number)).toBe(true);
      } finally {
        rmSync(stateDir, { recursive: true, force: true });
      }
    });

    it("lock contention on runs.jsonl → exit 3 CONFLICT", () => {
      const stateDir = mkdtempSync(path.join(os.tmpdir(), "at-bridge-stoplock-"));
      seedStateDir(stateDir);
      const holder = track(spawnSleeper());
      const run = makeRun("lockrun00001", holder.pid as number, new Date().toISOString());
      writeFileSync(getRunsFile(stateDir), `${JSON.stringify(run)}\n`, "utf8");
      // Hold the runs.jsonl lock with a live pid — same lock updateRun takes.
      const lockDir = getLockDir(getRunsFile(stateDir));
      mkdirSync(lockDir, { recursive: true });
      const lockPath = path.join(lockDir, pathToLockName(getRunsFile(stateDir)));
      writeFileSync(
        lockPath,
        JSON.stringify({ pid: holder.pid, hostname: os.hostname(), startedAt: new Date().toISOString() }),
        { flag: "wx" },
      );
      try {
        const r = runBridge(["bridge", "runs", "stop"], JSON.stringify({ id: "lockrun" }), {
          AT_STATE_DIR: stateDir,
        });
        expect(r.exitCode).toBe(3);
        expect(JSON.parse(r.stdout).error.code).toBe("CONFLICT");
      } finally {
        rmSync(stateDir, { recursive: true, force: true });
      }
    }, 20000);
  });

  describe("feedback", () => {
    it("add → ok, entry persisted to feedback.jsonl", () => {
      const stateDir = mkdtempSync(path.join(os.tmpdir(), "at-bridge-fbadd-"));
      seedStateDir(stateDir);
      try {
        const r = runBridge(
          ["bridge", "feedback", "add"],
          JSON.stringify({ text: "bridge works", kind: "improvement", tags: ["bridge"] }),
          { AT_STATE_DIR: stateDir },
        );
        expect(r.exitCode).toBe(0);
        const out = JSON.parse(r.stdout);
        expect(out.ok).toBe(true);
        expect(out.data.entry.text).toBe("bridge works");
        expect(out.data.entry.kind).toBe("improvement");
        expect(typeof out.data.entry.id).toBe("string");
        const file = path.join(stateDir, "feedback.jsonl");
        expect(existsSync(file)).toBe(true);
        expect(readFileSync(file, "utf8")).toContain("bridge works");
      } finally {
        rmSync(stateDir, { recursive: true, force: true });
      }
    });

    it("add missing text → exit 3 INVALID", () => {
      const stateDir = mkdtempSync(path.join(os.tmpdir(), "at-bridge-fbnotext-"));
      seedStateDir(stateDir);
      try {
        const r = runBridge(["bridge", "feedback", "add"], JSON.stringify({ kind: "bug" }), {
          AT_STATE_DIR: stateDir,
        });
        expect(r.exitCode).toBe(3);
        expect(JSON.parse(r.stdout).error.code).toBe("INVALID");
      } finally {
        rmSync(stateDir, { recursive: true, force: true });
      }
    });

    it("add bad kind → exit 3 INVALID", () => {
      const stateDir = mkdtempSync(path.join(os.tmpdir(), "at-bridge-fbkind-"));
      seedStateDir(stateDir);
      try {
        const r = runBridge(["bridge", "feedback", "add"], JSON.stringify({ text: "x", kind: "nope" }), {
          AT_STATE_DIR: stateDir,
        });
        expect(r.exitCode).toBe(3);
        expect(JSON.parse(r.stdout).error.code).toBe("INVALID");
      } finally {
        rmSync(stateDir, { recursive: true, force: true });
      }
    });

    it("update / resolve / rm round-trip", () => {
      const stateDir = mkdtempSync(path.join(os.tmpdir(), "at-bridge-fbrt-"));
      seedStateDir(stateDir);
      try {
        const add = runBridge(["bridge", "feedback", "add"], JSON.stringify({ text: "round trip" }), {
          AT_STATE_DIR: stateDir,
        });
        const id = JSON.parse(add.stdout).data.entry.id as string;

        const upd = runBridge(
          ["bridge", "feedback", "update"],
          JSON.stringify({ id, text: "round trip v2", kind: "bug" }),
          { AT_STATE_DIR: stateDir },
        );
        expect(upd.exitCode).toBe(0);
        expect(JSON.parse(upd.stdout).data.entry.text).toBe("round trip v2");

        const res = runBridge(["bridge", "feedback", "resolve"], JSON.stringify({ id }), {
          AT_STATE_DIR: stateDir,
        });
        expect(res.exitCode).toBe(0);
        expect(JSON.parse(res.stdout).data.entry.status).toBe("resolved");

        const rm = runBridge(["bridge", "feedback", "rm"], JSON.stringify({ ids: [id] }), {
          AT_STATE_DIR: stateDir,
        });
        expect(rm.exitCode).toBe(0);
        expect(JSON.parse(rm.stdout).data.removed).toBe(1);
        expect(readFileSync(path.join(stateDir, "feedback.jsonl"), "utf8").trim()).toBe("");
      } finally {
        rmSync(stateDir, { recursive: true, force: true });
      }
    });

    it("update unknown id → exit 3 NOT_FOUND", () => {
      const stateDir = mkdtempSync(path.join(os.tmpdir(), "at-bridge-fbnoid-"));
      seedStateDir(stateDir);
      try {
        const r = runBridge(["bridge", "feedback", "update"], JSON.stringify({ id: "ffff", text: "x" }), {
          AT_STATE_DIR: stateDir,
        });
        expect(r.exitCode).toBe(3);
        expect(JSON.parse(r.stdout).error.code).toBe("NOT_FOUND");
      } finally {
        rmSync(stateDir, { recursive: true, force: true });
      }
    });

    it("rm unknown id → exit 3 NOT_FOUND", () => {
      const stateDir = mkdtempSync(path.join(os.tmpdir(), "at-bridge-fbrmnoid-"));
      seedStateDir(stateDir);
      try {
        const r = runBridge(["bridge", "feedback", "rm"], JSON.stringify({ ids: ["ffff"] }), {
          AT_STATE_DIR: stateDir,
        });
        expect(r.exitCode).toBe(3);
        expect(JSON.parse(r.stdout).error.code).toBe("NOT_FOUND");
      } finally {
        rmSync(stateDir, { recursive: true, force: true });
      }
    });
  });

  describe("kanban", () => {
    function makeBoard(): string {
      const board = path.join(mkdtempSync(path.join(os.tmpdir(), "at-bridge-board-")), "kanban.md");
      const r = runCli(["kanban", "init", board], {});
      expect(r.exitCode).toBe(0);
      return board;
    }

    function listTasks(board: string): Array<Record<string, string>> {
      const r = runCli(["kanban", "list", board, "--json"], {});
      expect(r.exitCode).toBe(0);
      return JSON.parse(r.stdout).tasks as Array<Record<string, string>>;
    }

    it("add → status → remove round-trip", () => {
      const board = makeBoard();
      try {
        const add = runBridge(
          ["bridge", "kanban", "add"],
          JSON.stringify({ title: "bridge task", priority: "High", description: "via bridge", board }),
          {},
        );
        expect(add.exitCode).toBe(0);
        const added = JSON.parse(add.stdout);
        expect(added.ok).toBe(true);
        expect(added.data.id).toBe("T1");
        expect(added.data.task.Title).toBe("bridge task");

        const st = runBridge(
          ["bridge", "kanban", "status"],
          JSON.stringify({ id: "T1", status: "In Progress", board }),
          {},
        );
        expect(st.exitCode).toBe(0);
        expect(JSON.parse(st.stdout).data.status).toBe("In Progress");
        expect(listTasks(board).find((t) => t.ID === "T1")?.Status).toBe("In Progress");

        const rm = runBridge(["bridge", "kanban", "remove"], JSON.stringify({ id: "T1", board }), {});
        expect(rm.exitCode).toBe(0);
        expect(listTasks(board).find((t) => t.ID === "T1")).toBeUndefined();
      } finally {
        rmSync(path.dirname(board), { recursive: true, force: true });
      }
    });

    it("status with invalid status → exit 3 INVALID", () => {
      const board = makeBoard();
      try {
        runBridge(["bridge", "kanban", "add"], JSON.stringify({ title: "t", board }), {});
        const r = runBridge(["bridge", "kanban", "status"], JSON.stringify({ id: "T1", status: "Bogus", board }), {});
        expect(r.exitCode).toBe(3);
        expect(JSON.parse(r.stdout).error.code).toBe("INVALID");
      } finally {
        rmSync(path.dirname(board), { recursive: true, force: true });
      }
    });

    it("status unknown task → exit 3 NOT_FOUND", () => {
      const board = makeBoard();
      try {
        const r = runBridge(["bridge", "kanban", "status"], JSON.stringify({ id: "T99", status: "Done", board }), {});
        expect(r.exitCode).toBe(3);
        expect(JSON.parse(r.stdout).error.code).toBe("NOT_FOUND");
      } finally {
        rmSync(path.dirname(board), { recursive: true, force: true });
      }
    });

    it("missing board file → exit 3 NOT_FOUND", () => {
      const board = path.join(mkdtempSync(path.join(os.tmpdir(), "at-bridge-noboard-")), "missing.md");
      try {
        const r = runBridge(["bridge", "kanban", "add"], JSON.stringify({ title: "t", board }), {});
        expect(r.exitCode).toBe(3);
        expect(JSON.parse(r.stdout).error.code).toBe("NOT_FOUND");
      } finally {
        rmSync(path.dirname(board), { recursive: true, force: true });
      }
    });
  });

  describe("line", () => {
    function makeConfigDir(): string {
      const dir = mkdtempSync(path.join(os.tmpdir(), "at-bridge-line-"));
      return dir;
    }

    function readLine(dir: string): string[] {
      return (JSON.parse(readFileSync(path.join(dir, "config.json"), "utf8")) as { line?: string[] }).line ?? [];
    }

    it("add writes config + HMAC through the sign path", () => {
      const dir = makeConfigDir();
      try {
        const r = runBridge(["bridge", "line", "add"], JSON.stringify({ agent: "kilo" }), { AT_CONFIG_DIR: dir });
        expect(r.exitCode).toBe(0);
        expect(JSON.parse(r.stdout).data.line).toEqual(["kilo"]);
        expect(readLine(dir)).toEqual(["kilo"]);
        // HMAC matches the file content — same tamper-evidence as the CLI
        const data = readFileSync(path.join(dir, "config.json"), "utf8");
        expect(readFileSync(path.join(dir, "config.json.hmac"), "utf8")).toBe(computeHmac(data));
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });

    it("add duplicate → exit 3 CONFLICT", () => {
      const dir = makeConfigDir();
      try {
        runBridge(["bridge", "line", "add"], JSON.stringify({ agent: "kilo" }), { AT_CONFIG_DIR: dir });
        const r = runBridge(["bridge", "line", "add"], JSON.stringify({ agent: "kilo" }), { AT_CONFIG_DIR: dir });
        expect(r.exitCode).toBe(3);
        expect(JSON.parse(r.stdout).error.code).toBe("CONFLICT");
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });

    it("add unknown agent → exit 3 INVALID", () => {
      const dir = makeConfigDir();
      try {
        const r = runBridge(["bridge", "line", "add"], JSON.stringify({ agent: "nope" }), { AT_CONFIG_DIR: dir });
        expect(r.exitCode).toBe(3);
        expect(JSON.parse(r.stdout).error.code).toBe("INVALID");
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });

    it("rm / move round-trip", () => {
      const dir = makeConfigDir();
      try {
        runBridge(["bridge", "line", "add"], JSON.stringify({ agent: "kilo" }), { AT_CONFIG_DIR: dir });
        runBridge(["bridge", "line", "add"], JSON.stringify({ agent: "agy" }), { AT_CONFIG_DIR: dir });
        expect(readLine(dir)).toEqual(["kilo", "agy"]);

        const mv = runBridge(["bridge", "line", "move"], JSON.stringify({ agent: "agy", position: 1 }), {
          AT_CONFIG_DIR: dir,
        });
        expect(mv.exitCode).toBe(0);
        expect(JSON.parse(mv.stdout).data.line).toEqual(["agy", "kilo"]);

        const bad = runBridge(["bridge", "line", "move"], JSON.stringify({ agent: "agy", position: 9 }), {
          AT_CONFIG_DIR: dir,
        });
        expect(bad.exitCode).toBe(3);
        expect(JSON.parse(bad.stdout).error.code).toBe("INVALID");

        const rm = runBridge(["bridge", "line", "rm"], JSON.stringify({ agent: "kilo" }), { AT_CONFIG_DIR: dir });
        expect(rm.exitCode).toBe(0);
        expect(JSON.parse(rm.stdout).data.line).toEqual(["agy"]);

        const rmMissing = runBridge(["bridge", "line", "rm"], JSON.stringify({ agent: "kilo" }), {
          AT_CONFIG_DIR: dir,
        });
        expect(rmMissing.exitCode).toBe(3);
        expect(JSON.parse(rmMissing.stdout).error.code).toBe("NOT_FOUND");
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });
  });
});
