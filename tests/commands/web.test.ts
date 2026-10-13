import { type ChildProcess, spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { Command } from "commander";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { registerWebCommand, resolveWebBin, WebBinError } from "../../src/commands/web";

vi.mock("node:child_process", () => ({
  spawn: vi.fn(),
}));

vi.mock("../../src/static-dir", () => ({
  resolveWebUiStaticDir: vi.fn().mockImplementation((explicit?: string) => explicit ?? "/mock/static"),
}));

const mockSpawn = vi.mocked(spawn);

function makeProgram(): Command {
  const program = new Command();
  program.name("at");
  program.exitOverride();
  registerWebCommand(program);
  return program;
}

function createFakeChild(servingLine = "[at-web] serving on http://127.0.0.1:8765 (state: /tmp/st, /home/u/.at)") {
  const child = new EventEmitter() as ChildProcess;
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  child.stdout = stdout;
  child.stderr = stderr;
  (child as ChildProcess & { kill: ReturnType<typeof vi.fn> }).kill = vi.fn((signal: string) => {
    child.emit("exit", 0, signal);
  });
  setImmediate(() => {
    stderr.emit("data", Buffer.from(`${servingLine}\n`));
  });
  return child;
}

describe("resolveWebBin", () => {
  let tempDir: string;
  let originalPath: string | undefined;

  beforeEach(() => {
    tempDir = mkdtempSync(path.join(tmpdir(), "at-web-bin-"));
    originalPath = process.env.PATH;
    delete process.env.AT_WEB_BIN;
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
    if (originalPath !== undefined) {
      process.env.PATH = originalPath;
    } else {
      delete process.env.PATH;
    }
    delete process.env.AT_WEB_BIN;
  });

  it("returns the built bin/at-web when present", () => {
    const bin = path.join(tempDir, "bin", "at-web");
    mkdirSync(path.dirname(bin), { recursive: true });
    writeFileSync(bin, "");
    expect(resolveWebBin(tempDir)).toBe(bin);
  });

  it("falls back to PATH when the built binary is absent", () => {
    const bin = path.join(tempDir, "at-web");
    writeFileSync(bin, "");
    process.env.PATH = tempDir;
    expect(resolveWebBin(tempDir)).toBe(bin);
  });

  it("honours AT_WEB_BIN when the explicit file exists", () => {
    const bin = path.join(tempDir, "custom-web");
    process.env.AT_WEB_BIN = bin;
    writeFileSync(bin, "");
    expect(resolveWebBin(tempDir, process.env.AT_WEB_BIN)).toBe(bin);
  });

  it("throws a WebBinError with install hint when no binary is found", () => {
    process.env.PATH = tempDir;
    expect(() => resolveWebBin(tempDir)).toThrow(WebBinError);
    expect(() => resolveWebBin(tempDir)).toThrow(/pnpm run build:go/);
  });

  it("throws a WebBinError when AT_WEB_BIN points to a missing file", () => {
    const explicit = path.join(tempDir, "missing");
    expect(() => resolveWebBin(tempDir, explicit)).toThrow(WebBinError);
  });
});

describe("web command", () => {
  let fakeChild: ChildProcess;
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;
  let exitSpy: ReturnType<typeof vi.spyOn>;
  let onSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    mockSpawn.mockReset();
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    exitSpy = vi.spyOn(process, "exit").mockImplementation((code) => {
      throw new Error(`exit:${code}`);
    }) as ReturnType<typeof vi.spyOn>;
    onSpy = vi.spyOn(process, "on").mockReturnValue(process);
    delete process.env.AT_WEB_BIN;
    delete process.env.AT_STATE_DIR;
  });

  afterEach(() => {
    if (fakeChild) {
      fakeChild.stdout?.unpipe?.();
      fakeChild.stderr?.unpipe?.();
      fakeChild.stdout?.destroy?.();
      fakeChild.stderr?.destroy?.();
    }
    mockSpawn.mockRestore();
    logSpy.mockRestore();
    errorSpy.mockRestore();
    exitSpy.mockRestore();
    onSpy.mockRestore();
    delete process.env.AT_WEB_BIN;
    delete process.env.AT_STATE_DIR;
  });

  it("prints an install hint and exits 1 when the binary is missing", async () => {
    process.env.AT_WEB_BIN = path.join(tmpdir(), "at-web-missing-xyz");
    const program = makeProgram();
    await expect(program.parseAsync(["node", "at", "web"])).rejects.toThrow("exit:1");
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("Build with: pnpm run build:go"));
  });

  it("spawns the binary with default flags and prints the banner", async () => {
    process.env.AT_WEB_BIN = path.join(tmpdir(), "at-web-dummy");
    writeFileSync(process.env.AT_WEB_BIN, "");
    fakeChild = createFakeChild();
    mockSpawn.mockImplementation(() => fakeChild);

    const program = makeProgram();
    await program.parseAsync(["node", "at", "web"]);

    expect(mockSpawn).toHaveBeenCalledTimes(1);
    expect(mockSpawn).toHaveBeenCalledWith(
      process.env.AT_WEB_BIN,
      ["--port", "7800", "--host", "127.0.0.1", "--static", "/mock/static"],
      expect.objectContaining({ stdio: ["ignore", "pipe", "pipe"] }),
    );
    expect(logSpy).toHaveBeenCalledWith("[at] web: http://127.0.0.1:8765 (state: /tmp/st, /home/u/.at)");
    expect(logSpy).toHaveBeenCalledWith("[at] web: SSE http://127.0.0.1:8765/api/events");
  });

  it("forwards --port, --host, --static and --state-dir", async () => {
    process.env.AT_WEB_BIN = path.join(tmpdir(), "at-web-dummy");
    writeFileSync(process.env.AT_WEB_BIN, "");
    fakeChild = createFakeChild();
    mockSpawn.mockImplementation(() => fakeChild);

    const program = makeProgram();
    await program.parseAsync([
      "node",
      "at",
      "web",
      "--port",
      "0",
      "--host",
      "0.0.0.0",
      "--static",
      "/var/webui",
      "--state-dir",
      "/var/state",
    ]);

    expect(mockSpawn).toHaveBeenCalledWith(
      process.env.AT_WEB_BIN,
      ["--port", "0", "--host", "0.0.0.0", "--static", "/var/webui", "--state-dir", "/var/state"],
      expect.anything(),
    );
  });

  it("forwards SIGINT to the spawned child and exits with its code", async () => {
    process.env.AT_WEB_BIN = path.join(tmpdir(), "at-web-dummy");
    writeFileSync(process.env.AT_WEB_BIN, "");
    fakeChild = createFakeChild();
    mockSpawn.mockImplementation(() => fakeChild);

    const program = makeProgram();
    await program.parseAsync(["node", "at", "web", "-p", "0"]);

    const handler = onSpy.mock.calls.find((c) => c[0] === "SIGINT")?.[1] as () => void;
    expect(handler).toBeTypeOf("function");
    expect(() => handler()).toThrow("exit:0");
    expect(fakeChild.kill).toHaveBeenCalledWith("SIGINT");
  });

  it("forwards SIGTERM to the spawned child", async () => {
    process.env.AT_WEB_BIN = path.join(tmpdir(), "at-web-dummy");
    writeFileSync(process.env.AT_WEB_BIN, "");
    fakeChild = createFakeChild();
    mockSpawn.mockImplementation(() => fakeChild);

    const program = makeProgram();
    await program.parseAsync(["node", "at", "web", "-p", "0"]);

    const handler = onSpy.mock.calls.find((c) => c[0] === "SIGTERM")?.[1] as () => void;
    expect(handler).toBeTypeOf("function");
    expect(() => handler()).toThrow("exit:0");
    expect(fakeChild.kill).toHaveBeenCalledWith("SIGTERM");
  });
});
