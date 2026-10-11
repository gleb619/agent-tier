import type { Command } from "commander";
import { registerComposeCommand } from "../compose/cli";
import { registerCodegraphCommand } from "./codegraph";
import { registerConfigCommand } from "./config";
import { registerDefaultCommand } from "./default";
import { registerDiscussCommand } from "./discuss";
import { registerEventsCommand } from "./events";
import { registerFeedbackCommand } from "./feedback";
import { registerHealthCommands } from "./health";
import { registerInitCommand } from "./init";
import { registerKanbanCommand } from "./kanban";
import { registerLineCommand } from "./line";
import { registerMcpCommand } from "./mcp";
import { registerNotifyCommand } from "./notify";
import { registerServeCommand } from "./serve";
import { registerStatusCommand } from "./status";
import { registerStopCommand } from "./stop";
import { registerWebCommand } from "./web";

export function registerCommands(program: Command): void {
  registerDefaultCommand(program);
  registerConfigCommand(program);
  registerLineCommand(program);
  registerInitCommand(program);
  registerKanbanCommand(program);
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
  registerWebCommand(program);
  registerDiscussCommand(program);
}
