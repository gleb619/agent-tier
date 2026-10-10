import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Command } from 'commander';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { registerServeCommand } from '../../src/commands/serve';
import { startHub, type Hub } from '../../src/notify/hub';

// Stub startHub so the command never binds a real socket in the test process —
// we assert on the wiring (port, URL, signal handlers) instead.
vi.mock('../../src/notify/hub', () => ({
  startHub: vi.fn(),
}));

function makeProgram(): Command {
  const program = new Command();
  program.name('at');
  program.exitOverride();
  registerServeCommand(program);
  return program;
}

describe('serve command', () => {
  let stateDir: string;
  let fakeHub: Hub & { close: ReturnType<typeof vi.fn> };
  const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  const exitSpy = vi
    .spyOn(process, 'exit')
    .mockImplementation((() => undefined) as never);

  beforeEach(() => {
    stateDir = mkdtempSync(path.join(tmpdir(), 'at-serve-'));
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

  it('starts hub on port 0 and prints the events URL', async () => {
    const program = makeProgram();
    await program.parseAsync(['node', 'at', 'serve', '-p', '0']);

    expect(startHub).toHaveBeenCalledWith({ stateDir, port: 0 });
    expect(logSpy).toHaveBeenCalledWith('[at] serve: http://127.0.0.1:43210/events');
  });

  it('honours an explicit --port', async () => {
    const program = makeProgram();
    await program.parseAsync(['node', 'at', 'serve', '--port', '9999']);

    expect(startHub).toHaveBeenCalledWith({ stateDir, port: 9999 });
  });

  it('SIGINT closes the hub and exits 0', async () => {
    const onSpy = vi.spyOn(process, 'on');
    const program = makeProgram();
    await program.parseAsync(['node', 'at', 'serve', '-p', '0']);

    const sigint = onSpy.mock.calls.find((c) => c[0] === 'SIGINT')?.[1] as
      | (() => Promise<void>)
      | undefined;
    expect(sigint).toBeTypeOf('function');

    await sigint!();
    expect(fakeHub.close).toHaveBeenCalledTimes(1);
    expect(exitSpy).toHaveBeenCalledWith(0);
    onSpy.mockRestore();
  });

  it('SIGTERM closes the hub and exits 0', async () => {
    const onSpy = vi.spyOn(process, 'on');
    const program = makeProgram();
    await program.parseAsync(['node', 'at', 'serve', '-p', '0']);

    const sigterm = onSpy.mock.calls.find((c) => c[0] === 'SIGTERM')?.[1] as
      | (() => Promise<void>)
      | undefined;
    expect(sigterm).toBeTypeOf('function');

    await sigterm!();
    expect(fakeHub.close).toHaveBeenCalledTimes(1);
    expect(exitSpy).toHaveBeenCalledWith(0);
    onSpy.mockRestore();
  });
});
