import { spawn } from "node:child_process";
import { getClockTickMs, getProcessTicks } from "../src/process-utils";

describe("getClockTickMs", () => {
  it("returns a positive number", () => {
    const tickMs = getClockTickMs();
    expect(typeof tickMs).toBe("number");
    expect(tickMs).toBeGreaterThan(0);
    expect(tickMs).toBeLessThanOrEqual(1000);
  });
});

describe("getProcessTicks", () => {
  it("returns null for non-existent pid", () => {
    expect(getProcessTicks(999999999)).toBeNull();
  });

  it("returns non-negative ms for current process", () => {
    const ticks = getProcessTicks(process.pid);
    expect(ticks).not.toBeNull();
    expect(ticks as number).toBeGreaterThanOrEqual(0);
  });

  it("returns > 0 ms for a busy child process", async () => {
    // busy child accumulates CPU ticks while it runs
    const child = spawn("node", ["-e", "const end = Date.now() + 600; while (Date.now() < end) {}"]);
    // give it ~250ms to accrue measurable ticks
    await new Promise((r) => setTimeout(r, 250));
    const ticks = getProcessTicks(child.pid!);
    child.kill("SIGKILL");
    expect(ticks).not.toBeNull();
    expect(ticks as number).toBeGreaterThan(0);
  });
});
