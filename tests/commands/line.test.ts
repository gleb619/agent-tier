import { Command } from "commander";
import { afterEach, describe, expect, it, vi } from "vitest";
import { registerLineCommand } from "../../src/commands/line";

describe("line command", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("registers subcommands", () => {
    const program = new Command();
    program.name("at");
    program.exitOverride();
    registerLineCommand(program);

    const sub = program.commands.find((c) => c.name() === "line");
    expect(sub).toBeDefined();
    expect(sub!.commands.find((c) => c.name() === "show")).toBeDefined();
    expect(sub!.commands.find((c) => c.name() === "add")).toBeDefined();
    expect(sub!.commands.find((c) => c.name() === "rm")).toBeDefined();
    expect(sub!.commands.find((c) => c.name() === "move")).toBeDefined();
  });
});
