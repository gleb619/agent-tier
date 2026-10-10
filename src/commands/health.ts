import { Command } from 'commander';
import { setDeactivated } from '../health';
import { resolveStateDir, getStateFilePath } from '../state-dir';
import { getAgentByName } from '../agents/registry';

function validateAgent(agent: string): void {
  if (!getAgentByName(agent)) {
    console.error(`[at] error: Unknown agent: ${agent}`);
    process.exit(1);
  }
}

export function registerHealthCommands(program: Command): void {
  program
    .command('enable <agent>')
    .description('Re-enable a deactivated agent')
    .action(async (agent: string) => {
      try {
        validateAgent(agent);
        const stateDir = resolveStateDir();
        const stateFilePath = getStateFilePath(stateDir);
        await setDeactivated(stateFilePath, agent, false);
        console.log(`[at] agent "${agent}" enabled`);
      } catch (err) {
        console.error(`[at] error: ${(err as Error).message}`);
        process.exit(1);
      }
    });

  program
    .command('disable <agent>')
    .description('Deactivate an agent (cannot be used even with -a)')
    .action(async (agent: string) => {
      try {
        validateAgent(agent);
        const stateDir = resolveStateDir();
        const stateFilePath = getStateFilePath(stateDir);
        await setDeactivated(stateFilePath, agent, true);
        console.log(`[at] agent "${agent}" deactivated`);
      } catch (err) {
        console.error(`[at] error: ${(err as Error).message}`);
        process.exit(1);
      }
    });
}
