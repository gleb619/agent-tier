import { Command } from 'commander';
import { startHub } from '../notify/hub';
import { resolveStateDir } from '../state-dir';

export function registerServeCommand(program: Command): void {
  program
    .command('serve')
    .description('Start standalone SSE events hub for the state directory')
    .option('-p, --port <number>', 'Port (0=random)', '7777')
    .action(async (opts: { port: string }) => {
      const stateDir = resolveStateDir();
      const port = Number(opts.port);
      const hub = await startHub({ stateDir, port });
      console.log(`[at] serve: http://127.0.0.1:${hub.port}/events`);
      process.on('SIGINT', async () => {
        await hub.close();
        process.exit(0);
      });
      process.on('SIGTERM', async () => {
        await hub.close();
        process.exit(0);
      });
    });
}
