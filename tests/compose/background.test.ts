import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  buildJobArgs,
  defaultJobName,
  listJobs,
  readJob,
  startJob,
  stopJob,
  tailLog,
} from "../../src/compose/background";
import { isPidAlive } from "../../src/process-utils";
import { cleanupTmpDirs, makeTmpDir } from "../kanban/helpers";

describe("compose background jobs", () => {
  let stateDir: string;
  beforeEach(() => {
    stateDir = makeTmpDir("at-jobs-");
  });
  afterEach(() => cleanupTmpDirs());

  it("strips background-only flags from the child argv", () => {
    expect(buildJobArgs(["compose", "--loop", "--background", "--name", "x", "--follow", "30"])).toEqual([
      "compose",
      "--loop",
      "--follow",
      "30",
    ]);
    expect(buildJobArgs(["compose", "--task", "T7", "--name=y", "--background"])).toEqual(["compose", "--task", "T7"]);
  });

  it("names jobs by task id, else 'loop'", () => {
    expect(defaultJobName("T7")).toBe("t7");
    expect(defaultJobName(undefined)).toBe("loop");
  });

  it("starts a detached job, logs its output, lists it and stops it", async () => {
    const script = path.join(stateDir, "fake-at.sh");
    // Stand-in for `at`: prints args then idles until SIGTERM.
    const fs = await import("node:fs");
    fs.writeFileSync(script, '#!/bin/sh\necho "args:$@ job:$AT_COMPOSE_JOB"\nsleep 30 &\nwait\n', { mode: 0o755 });

    const rec = startJob({ stateDir, name: "loop", args: ["compose", "--loop"], cwd: stateDir, bin: script });
    try {
      expect(isPidAlive(rec.pid)).toBe(true);
      expect(listJobs(stateDir).map((j) => [j.name, j.alive])).toEqual([["loop", true]]);
      expect(() => startJob({ stateDir, name: "loop", args: [], cwd: stateDir, bin: script })).toThrow(
        /already running/,
      );

      await new Promise((r) => setTimeout(r, 300));
      expect(readFileSync(rec.logFile, "utf8")).toContain("args:compose --loop job:loop");
      expect(tailLog(rec.logFile, 5)).toContain("job:loop");

      stopJob(stateDir, "loop", false);
      await new Promise((r) => setTimeout(r, 300));
      expect(readJob(stateDir, "loop")?.alive).toBe(false);
    } finally {
      try {
        process.kill(-rec.pid, "SIGKILL");
      } catch {
        // already gone
      }
    }
  });

  it("rejects bad names and unknown jobs", () => {
    expect(() => startJob({ stateDir, name: "../x", args: [], cwd: stateDir })).toThrow(/invalid job name/);
    expect(() => stopJob(stateDir, "nope", false)).toThrow(/not found/);
  });
});
