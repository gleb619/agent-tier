import { describe, it, expect, vi, afterEach } from 'vitest';
import { Command } from 'commander';
import { registerDefaultCommand } from '../../src/commands/default';
import * as runner from '../../src/runner';
import * as genericLoader from '../../src/agents/generic-loader';
import * as config from '../../src/config';

describe('default (root) command', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('parses -r 2 as retries', async () => {
    const runSpy = vi.spyOn(runner, 'run').mockResolvedValue(0);
    vi.spyOn(genericLoader, 'loadGenericAgents').mockReturnValue([]);
    vi.spyOn(config, 'loadConfig').mockReturnValue(null);

    const program = new Command();
    program.name('at');
    program.exitOverride();
    registerDefaultCommand(program);

    await program.parseAsync(['node', 'at', '-r', '2', '-p', 'hello']);

    expect(runSpy).toHaveBeenCalled();
    const options = runSpy.mock.calls[0][0];
    expect(options.retries).toBe(2);
    expect(options.prompt).toBe('hello');
  });
});
