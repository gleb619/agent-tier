import { spawn } from "node:child_process";
import { describe, expect, it } from "vitest";
import { waitForBoot } from "./harness";

describe("waitForBoot", () => {
  it("resolves with the URL from the boot line", async () => {
    const child = spawn(process.execPath, ["-e", 'console.log("[at] web: http://127.0.0.1:4123")'], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    await expect(waitForBoot(child)).resolves.toBe("http://127.0.0.1:4123");
    child.kill();
  });

  it("rejects and kills the child when the boot line never appears", async () => {
    const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    await expect(waitForBoot(child, 300)).rejects.toThrow(/did not start/);
    // The kill signal needs a tick to land; the child must not outlive us.
    await new Promise((r) => setTimeout(r, 200));
    expect(child.signalCode ?? child.exitCode).not.toBeNull();
  }, 10_000);
});
