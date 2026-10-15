import { afterEach, describe, expect, it, vi } from "vitest";
import { discussOptIn } from "../src/compose/cli";
import { discussEnabled } from "../src/discuss-flag";
import { makeClaudeAdapter } from "../src/notify/adapters/claude";
import { makeClineAdapter } from "../src/notify/adapters/cline";
import { appendDiscussInstruction } from "../src/notify/prompt";

describe("discuss experimental flag", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("is off by default and on for AT_DISCUSS=1|true|yes|on", () => {
    expect(discussEnabled({})).toBe(false);
    expect(discussEnabled({ AT_DISCUSS: "0" })).toBe(false);
    for (const v of ["1", "true", "YES", "on"]) expect(discussEnabled({ AT_DISCUSS: v })).toBe(true);
  });

  it("compose opt-in: --discuss flag or env", () => {
    expect(discussOptIn(undefined, {})).toBe(false);
    expect(discussOptIn(true, {})).toBe(true);
    expect(discussOptIn(false, { AT_DISCUSS: "1" })).toBe(true);
  });

  it("prompt suffix is untouched when disabled", () => {
    vi.stubEnv("AT_DISCUSS", "");
    expect(appendDiscussInstruction("")).toBe("");
    expect(appendDiscussInstruction("keep")).toBe("keep");
    expect(makeClaudeAdapter("claude").promptSuffix?.({ runId: "r", eventFile: "/x" }) ?? "").toBe("");
    const cline = makeClineAdapter();
    expect(cline.promptSuffix?.({ runId: "r", eventFile: "/x" }) ?? "").toBe("");
    expect(cline.promptPrefix?.({ runId: "r", eventFile: "/x" }) ?? "").toBe("");
  });

  it("prompt suffix present when enabled", () => {
    vi.stubEnv("AT_DISCUSS", "1");
    expect(appendDiscussInstruction("")).toContain("discuss ask");
  });
});

describe("at discuss command gate", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("exits 2 with an experimental message when disabled", async () => {
    vi.stubEnv("AT_DISCUSS", "");
    const { Command } = await import("commander");
    const { registerDiscussCommand } = await import("../src/commands/discuss");
    const program = new Command();
    program.exitOverride();
    registerDiscussCommand(program);
    const exit = vi.spyOn(process, "exit").mockImplementation((() => {
      throw new Error("exit");
    }) as never);
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(program.parseAsync(["node", "at", "discuss", "inbox", "-R", "r1"])).rejects.toThrow("exit");
    expect(exit).toHaveBeenCalledWith(2);
    expect(err.mock.calls.join("\n")).toContain("experimental");
    exit.mockRestore();
    err.mockRestore();
  });
});
