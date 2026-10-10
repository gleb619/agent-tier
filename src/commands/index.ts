import { Command } from 'commander';
import { registerDefaultCommand } from './default';
import { registerConfigCommand } from './config';
import { registerInitCommand } from './init';
import { registerStatusCommand } from './status';
import { registerStopCommand } from './stop';
import { registerHealthCommands } from './health';
import { registerCodegraphCommand } from './codegraph';
import { registerComposeCommand } from '../compose/cli';
import { registerMcpCommand } from './mcp';
import { registerFeedbackCommand } from './feedback';
import { registerNotifyCommand } from './notify';
import { registerEventsCommand } from './events';
import { registerServeCommand } from './serve';
import { registerDiscussCommand } from './discuss';

export function registerCommands(program: Command): void {
  registerDefaultCommand(program);
  registerConfigCommand(program);
  registerInitCommand(program);
  registerStatusCommand(program);
  registerStopCommand(program);
  registerHealthCommands(program);
  registerCodegraphCommand(program);
  registerComposeCommand(program);
  registerMcpCommand(program);
  registerFeedbackCommand(program);
  registerNotifyCommand(program);
  registerEventsCommand(program);
  registerServeCommand(program);
  registerDiscussCommand(program);
}
