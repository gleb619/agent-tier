import { Command } from 'commander';
import { registerDefaultCommand } from './default';
import { registerConfigCommand } from './config';
import { registerInitCommand } from './init';
import { registerStatusCommand } from './status';
import { registerHealthCommands } from './health';
import { registerCodegraphCommand } from './codegraph';
import { registerComposeCommand } from '../compose/delivery/cli';
import { registerMcpCommand } from './mcp';

export function registerCommands(program: Command): void {
  registerDefaultCommand(program);
  registerConfigCommand(program);
  registerInitCommand(program);
  registerStatusCommand(program);
  registerHealthCommands(program);
  registerCodegraphCommand(program);
  registerComposeCommand(program);
  registerMcpCommand(program);
}
