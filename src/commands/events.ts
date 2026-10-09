import { Command } from 'commander';
import { readEventsSince } from '../notify/store';
import { resolveStateDir } from '../state-dir';

export function registerEventsCommand(program: Command): void {
  program
    .command('events <runId>')
    .description('Print stored events for a run; -f to follow new events')
    .option('-f, --follow', 'Follow new events', false)
    .action(async (runId: string, opts: { follow: boolean }) => {
      const stateDir = resolveStateDir();
      let lastSeq = 0;
      const printNew = () => {
        const events = readEventsSince(stateDir, runId, lastSeq);
        for (const e of events) {
          console.log(JSON.stringify(e));
          if (e.seq > lastSeq) lastSeq = e.seq;
        }
      };
      printNew();
      if (!opts.follow) return;
      const interval = setInterval(printNew, 500);
      process.on('SIGINT', () => {
        clearInterval(interval);
        process.exit(0);
      });
      process.on('SIGTERM', () => {
        clearInterval(interval);
        process.exit(0);
      });
    });
}
