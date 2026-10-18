import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Command } from "commander";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { registerServeCommand } from "../../src/commands/serve";
import { requestDaemon } from "../../src/notify/daemon-sock";
import { type Hub, startHub } from "../../src/notify/hub";
import type { NotifyEvent } from "../../src/notify/types";

// Stub startHub so the command never binds a real TCP socket in the test process —
// we assert on the wiring (port, URL, signal handlers) instead. The daemon's unix
// socket is real (it is the object under test); createIngest/ingestDiscuss are
// only needed as defined exports since serve.ts imports them.
vi.mock("../../src/notify/hub", () => ({
  startHub: vi.fn(),
  createIngest: vi.fn(() => ({ publish: (e: NotifyEvent) => e })),
  ingestDiscuss: vi.fn(() => null),
}));

function makeProgram(): Command {
  const program = new Command();
  program.name("at");
  program.exitOverride();
  registerServeCommand(program);
  return program;
}

describe("serve command", () => {
  let stateDir: string;
  let fakeHub: Hub & { close: ReturnType<typeof vi.fn> };
  const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  const exitSpy = vi.spyOn(process, "exit").mockImplementation((() => undefined) as never);

  beforeEach(() => {
    stateDir = mkdtempSync(path.join(tmpdir(), "at-serve-"));
    process.env.AT_STATE_DIR = stateDir;
    fakeHub = {
      port: 43210,
      requestedPort: 0,
      hadActiveClients: false,
      close: vi.fn().mockResolvedValue(undefined),
      publish: vi.fn(),
    };
    (startHub as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(fakeHub);
    logSpy.mockClear();
    exitSpy.mockClear();
  });

  afterEach(() => {
    rmSync(stateDir, { recursive: true, force: true });
    delete process.env.AT_STATE_DIR;
    vi.clearAllMocks();
  });

  it("starts hub on port 0 and prints the events URL", async () => {
    const program = makeProgram();
    await program.parseAsync(["node", "at", "serve", "-p", "0"]);

    expect(startHub).toHaveBeenCalledWith({ stateDir, port: 0 });
    expect(logSpy).toHaveBeenCalledWith("[at] serve: http://127.0.0.1:43210/events");
  });

  it("honours an explicit --port", async () => {
    const program = makeProgram();
    await program.parseAsync(["node", "at", "serve", "--port", "9999"]);

    expect(startHub).toHaveBeenCalledWith({ stateDir, port: 9999 });
  });

  it("SIGINT closes the hub and exits 0", async () => {
    const onSpy = vi.spyOn(process, "on");
    const program = makeProgram();
    await program.parseAsync(["node", "at", "serve", "-p", "0"]);

    const sigint = onSpy.mock.calls.find((c) => c[0] === "SIGINT")?.[1] as (() => Promise<void>) | undefined;
    expect(sigint).toBeTypeOf("function");

    await sigint!();
    expect(fakeHub.close).toHaveBeenCalledTimes(1);
    expect(exitSpy).toHaveBeenCalledWith(0);
    onSpy.mockRestore();
  });

  it("SIGTERM closes the hub and exits 0", async () => {
    const onSpy = vi.spyOn(process, "on");
    const program = makeProgram();
    await program.parseAsync(["node", "at", "serve", "-p", "0"]);

    const sigterm = onSpy.mock.calls.find((c) => c[0] === "SIGTERM")?.[1] as (() => Promise<void>) | undefined;
    expect(sigterm).toBeTypeOf("function");

    await sigterm!();
    expect(fakeHub.close).toHaveBeenCalledTimes(1);
    expect(exitSpy).toHaveBeenCalledWith(0);
    onSpy.mockRestore();
  });

  it("--daemon serves the broker over daemon.sock alongside the hub", async () => {
    // The daemon client refuses to talk when these are set; the suite must not
    // inherit them from the `at` process that happens to run it.
    delete process.env.AT_NO_DAEMON;
    delete process.env.AT_DEPTH;

    const onSpy = vi.spyOn(process, "on");
    const program = makeProgram();
    await program.parseAsync(["node", "at", "serve", "--daemon", "-p", "0"]);

    const sockPath = path.join(stateDir, "daemon.sock");
    expect(existsSync(sockPath)).toBe(true);
    expect(logSpy).toHaveBeenCalledWith(`[at] serve --daemon: ${sockPath}`);
    expect(logSpy).toHaveBeenCalledWith("[at] serve: http://127.0.0.1:43210/events");

    // Real frame through the real socket: ping answers with the hub port so
    // consumers can hand agents a live SSE URL without binding their own.
    const ping = await requestDaemon(stateDir, "ping", undefined, { timeoutMs: 2000 });
    expect(ping?.ok).toBe(true);
    expect(ping?.data).toMatchObject({ pong: true, port: 43210 });

    const sigint = onSpy.mock.calls.find((c) => c[0] === "SIGINT")?.[1] as (() => Promise<void>) | undefined;
    await sigint!();
    expect(fakeHub.close).toHaveBeenCalledTimes(1);
    expect(existsSync(sockPath)).toBe(false);
    expect(exitSpy).toHaveBeenCalledWith(0);
    onSpy.mockRestore();
  });
});
