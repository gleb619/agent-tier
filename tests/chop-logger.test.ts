import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { CHOP_INSTALL_SCRIPT_URL, ChopLogger, findChopOnPath, resolveChopInstallDir } from "../src/chop";

const h = vi.hoisted(() => ({
  spawnMock: vi.fn(),
  spawnSyncMock: vi.fn(),
  realSpawn: null as unknown as typeof import("child_process").spawn,
  realSpawnSync: null as unknown as typeof import("child_process").spawnSync,
}));

vi.mock("child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("child_process")>();
  const { EventEmitter } = await import("node:events");
  h.realSpawn = actual.spawn;
  h.realSpawnSync = actual.spawnSync;
  return {
    ...actual,
    spawn: (...args: unknown[]) => h.spawnMock(...(args as [])),
    spawnSync: (...args: unknown[]) => h.spawnSyncMock(...(args as [])),
    EventEmitter,
  };
});

function makeFakeChild() {
  const { EventEmitter } = require("node:events") as typeof import("events");
  const child = new EventEmitter() as any;
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.kill = vi.fn();
  return child;
}

function writeFakeChop(dir: string, script: string): string {
  const binPath = path.join(dir, "chop");
  mkdirSync(dir, { recursive: true });
  writeFileSync(binPath, `#!/bin/sh\n${script}\n`, { mode: 0o755 });
  return binPath;
}

function chopTempFiles(): string[] {
  return readdirSync(os.tmpdir()).filter((f) => f.startsWith("agent-tier-chop-"));
}

function captureStdout(): { text: () => string } {
  let out = "";
  vi.spyOn(process.stdout, "write").mockImplementation((chunk: any) => {
    out += String(chunk);
    return true;
  });
  return { text: () => out };
}

function captureStderr(): { text: () => string } {
  let err = "";
  vi.spyOn(process.stderr, "write").mockImplementation((chunk: any) => {
    err += String(chunk);
    return true;
  });
  return { text: () => err };
}

function chopOnPathAvailable(): boolean {
  const res = spawnSync("chop", ["version"], { stdio: "ignore" });
  return !res.error;
}

describe("ChopLogger", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(path.join(os.tmpdir(), "chop-logger-test-"));
    h.spawnMock.mockReset();
    h.spawnMock.mockImplementation((...args: unknown[]) => (h.realSpawn as any)(...args));
    h.spawnSyncMock.mockReset();
    h.spawnSyncMock.mockImplementation((...args: unknown[]) => (h.realSpawnSync as any)(...args));
  });

  afterEach(() => {
    vi.restoreAllMocks();
    try {
      rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // tmp dir cleanup best-effort
    }
    // Clean up any leftover chop temp files from this test
    try {
      const tempFiles = readdirSync(os.tmpdir())
        .filter((f) => f.startsWith("agent-tier-chop-"))
        .map((f) => path.join(os.tmpdir(), f));
      for (const file of tempFiles) {
        try {
          unlinkSync(file);
        } catch {
          // best effort cleanup
        }
      }
    } catch {
      // ignore errors in temp dir cleanup
    }
  });

  it("buffers lines without printing and clears the buffer on flush", async () => {
    const installDir = path.join(tmpDir, "isolated");
    writeFakeChop(installDir, 'echo "ARGS:$*"\nif [ -f "$2" ]; then cat "$2"; fi\nexit 0');
    const logger = new ChopLogger(installDir);
    const out = captureStdout();

    logger.log("[INFO] first");
    logger.log("[INFO] second");
    logger.log("[INFO] third");

    expect(logger.pending).toBe(3);
    expect(out.text()).toBe("");

    await logger.flush();

    expect(logger.pending).toBe(0);
    expect(out.text()).toContain("ARGS:cat");
    expect(out.text()).toContain("[INFO] first");
    expect(out.text()).toContain("[INFO] third");
    expect(chopTempFiles()).toEqual([]);
  });

  it("accepts an options object for the install dir", async () => {
    const installDir = path.join(tmpDir, "opts");
    writeFakeChop(installDir, 'cat "$2"\nexit 0');
    const logger = new ChopLogger({ installDir });
    const out = captureStdout();

    logger.log("line via options");
    await logger.flush();

    expect(logger.binaryPath).toBe(path.join(installDir, "chop"));
    expect(out.text()).toContain("line via options");
  });

  it("writes the batch to a 0o600 temp file and removes it afterwards", async () => {
    const installDir = path.join(tmpDir, "perm");
    writeFakeChop(installDir, 'stat -c "%a" "$2"');
    const logger = new ChopLogger(installDir);
    const out = captureStdout();

    logger.log("line a");
    logger.log("line b");
    await logger.flush();

    expect(out.text().trim()).toBe("600");
    expect(chopTempFiles()).toEqual([]);
  });

  it("clear() drops buffered lines", async () => {
    const logger = new ChopLogger(path.join(tmpDir, "unused"));
    logger.log("a");
    logger.log("b");
    logger.clear();
    expect(logger.pending).toBe(0);
    await logger.flush();
  });

  it("falls back to raw output when no chop binary is available", async () => {
    h.spawnSyncMock.mockReturnValue({ error: new Error("ENOENT") } as any);
    const child = makeFakeChild();
    h.spawnMock.mockImplementation(() => child as any);
    const logger = new ChopLogger(path.join(tmpDir, "missing"));
    const out = captureStdout();
    const err = captureStderr();

    const installing = logger.ensureInstalled();
    await Promise.resolve();
    child.emit("close", 1); // installer failed, no binary written
    const installed = await installing;

    expect(installed).toBe(false);
    expect(logger.resolveBinary()).toBeNull();

    logger.log("[INFO] kept raw 1");
    logger.log("[INFO] kept raw 2");
    await logger.flush();

    expect(out.text()).toBe("[INFO] kept raw 1\n[INFO] kept raw 2\n");
    expect(err.text()).not.toContain("permission denied");
    expect(chopTempFiles()).toEqual([]);
  });

  it("falls back to raw output when chop exits non-zero", async () => {
    const installDir = path.join(tmpDir, "fail");
    writeFakeChop(installDir, "echo boom >&2\nexit 3");
    const logger = new ChopLogger(installDir);
    const out = captureStdout();
    const err = captureStderr();

    logger.log("raw fallback line");
    await logger.flush();

    expect(out.text()).toBe("raw fallback line\n");
    expect(err.text()).toContain("[at] chop:");
    expect(chopTempFiles()).toEqual([]);
  });

  it("falls back to raw output when chop prints nothing", async () => {
    const installDir = path.join(tmpDir, "silent");
    writeFakeChop(installDir, "exit 0");
    const logger = new ChopLogger(installDir);
    const out = captureStdout();

    logger.log("raw fallback line");
    await logger.flush();

    expect(out.text()).toBe("raw fallback line\n");
  });

  it("ensureInstalled is a no-op when the isolated binary exists", async () => {
    const installDir = path.join(tmpDir, "present");
    writeFakeChop(installDir, "exit 0");
    const logger = new ChopLogger(installDir);

    await expect(logger.ensureInstalled()).resolves.toBe(true);
    await expect(logger.ensureInstalled()).resolves.toBe(true);
    expect(h.spawnMock).not.toHaveBeenCalled();
  });

  it("ensureInstalled reuses a chop binary found on PATH", async () => {
    h.spawnSyncMock.mockReturnValue({ status: 0, error: undefined } as any);
    const logger = new ChopLogger(path.join(tmpDir, "empty"));

    await expect(logger.ensureInstalled()).resolves.toBe(true);
    expect(h.spawnMock).not.toHaveBeenCalled();
  });

  it("ensureInstalled installs chop into the isolated dir via the official script", async () => {
    h.spawnSyncMock.mockReturnValue({ error: new Error("ENOENT") } as any);
    const installDir = path.join(tmpDir, "install");
    const logger = new ChopLogger(installDir);
    const child = makeFakeChild();
    h.spawnMock.mockImplementation(() => child as any);

    const pending = logger.ensureInstalled();
    await Promise.resolve();

    const [cmd, args] = h.spawnMock.mock.calls[0];
    expect(cmd).toBe("sh");
    expect((args as string[])[0]).toBe("-c");
    expect((args as string[])[1]).toContain(CHOP_INSTALL_SCRIPT_URL);
    expect((args as string[])[1]).toContain(`CHOP_INSTALL_DIR="${installDir}"`);

    // Installer "writes" the binary, then exits 0.
    writeFakeChop(installDir, 'cat "$2"\nexit 0');
    child.emit("close", 0);

    await expect(pending).resolves.toBe(true);
    expect(logger.binaryPath).toBe(path.join(installDir, "chop"));
    expect(existsSync(logger.binaryPath)).toBe(true);
  });

  it("ensureInstalled returns false (no throw) when the installer fails", async () => {
    h.spawnSyncMock.mockReturnValue({ error: new Error("ENOENT") } as any);
    const logger = new ChopLogger(path.join(tmpDir, "bad-install"));
    const child = makeFakeChild();
    h.spawnMock.mockImplementation(() => child as any);
    const err = captureStderr();

    const pending = logger.ensureInstalled();
    await Promise.resolve();
    child.emit("close", 127);

    await expect(pending).resolves.toBe(false);
    expect(err.text()).toContain("install failed");
    expect(h.spawnMock).toHaveBeenCalledTimes(1);
  });

  it("ensureInstalled swallows install spawn errors", async () => {
    h.spawnSyncMock.mockReturnValue({ error: new Error("ENOENT") } as any);
    const logger = new ChopLogger(path.join(tmpDir, "spawn-error"));
    const child = makeFakeChild();
    h.spawnMock.mockImplementation(() => child as any);

    const pending = logger.ensureInstalled();
    await Promise.resolve();
    child.emit("error", new Error("ENOENT: sh not found"));

    await expect(pending).resolves.toBe(false);
  });

  it("kills a hung chop run and falls back to raw output", async () => {
    const installDir = path.join(tmpDir, "hang");
    writeFakeChop(installDir, "sleep 5");
    const logger = new ChopLogger({ installDir, timeoutMs: 100 });
    const out = captureStdout();

    logger.log("hung run raw fallback");
    await logger.flush();

    expect(out.text()).toBe("hung run raw fallback\n");
    expect(chopTempFiles()).toEqual([]);
  }, 10000);

  it("does not spawn chop for an empty buffer", async () => {
    const logger = new ChopLogger(path.join(tmpDir, "empty-buffer"));
    await logger.flush();
    expect(h.spawnMock).not.toHaveBeenCalled();
  });

  describe("helpers", () => {
    it('findChopOnPath returns "chop" when resolvable', () => {
      h.spawnSyncMock.mockReturnValue({ status: 0, error: undefined } as any);
      expect(findChopOnPath()).toBe("chop");
    });

    it("findChopOnPath returns null when chop is missing", () => {
      h.spawnSyncMock.mockReturnValue({ error: new Error("ENOENT") } as any);
      expect(findChopOnPath()).toBeNull();
    });

    it("resolveChopInstallDir defaults to ~/.at/chop", () => {
      delete process.env.AT_CHOP_DIR;
      expect(resolveChopInstallDir()).toBe(path.join(os.homedir(), ".at", "chop"));
    });

    it("resolveChopInstallDir honours AT_CHOP_DIR", () => {
      process.env.AT_CHOP_DIR = "/tmp/custom-chop-dir";
      expect(resolveChopInstallDir()).toBe("/tmp/custom-chop-dir");
      delete process.env.AT_CHOP_DIR;
    });
  });

  describe("real chop binary (integration)", () => {
    it("installs the real chop binary into the isolated dir and compresses through it", async () => {
      const probe = spawnSync("curl", ["-fsSL", "--max-time", "5", "-o", "/dev/null", CHOP_INSTALL_SCRIPT_URL], {
        stdio: "ignore",
      });
      if (probe.error || probe.status !== 0) {
        console.log("SKIP: no network access to chop installer");
        return;
      }
      h.spawnSyncMock.mockReturnValue({ error: new Error("ENOENT") } as any);
      const installDir = path.join(tmpDir, "real-install");
      const logger = new ChopLogger(installDir);
      const out = captureStdout();

      await expect(logger.ensureInstalled()).resolves.toBe(true);
      expect(existsSync(logger.binaryPath)).toBe(true);

      for (let i = 0; i < 40; i++) {
        logger.log("2026-10-10T00:00:00Z INFO requesting token from cache");
      }
      logger.log("2026-10-10T00:01:00Z INFO done");
      await logger.flush();

      expect(out.text()).toContain("(x40)");
      expect(chopTempFiles()).toEqual([]);
    }, 120000);

    it("compresses repetitive log lines via `chop cat`", async () => {
      if (!chopOnPathAvailable()) {
        console.log("SKIP: chop binary not found on PATH");
        return;
      }
      const logger = new ChopLogger(path.join(tmpDir, "real-absent"));
      if (!existsSync(logger.binaryPath)) {
        expect(logger.resolveBinary()).toBe("chop");
      }
      const out = captureStdout();

      for (let i = 0; i < 40; i++) {
        logger.log("2026-10-10T00:00:00Z INFO requesting token from cache");
      }
      logger.log("2026-10-10T00:01:00Z INFO done");
      const raw = logger.pending;
      await logger.flush();

      const compressed = out.text();
      expect(raw).toBe(41);
      expect(compressed).toContain("(x40)");
      expect(compressed.length).toBeLessThan(41 * "2026-10-10T00:00:00Z INFO requesting token from cache".length);
      expect(chopTempFiles()).toEqual([]);
    });
  });
});
