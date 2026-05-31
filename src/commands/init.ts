import { Command } from 'commander';
import { runInit, formatInitResults } from '../init/index';

export function registerInitCommand(program: Command): void {
  program
    .command('init [agent]')
    .description('Create wrapper scripts for built-in agents')
    .option('-a, --all', 'Initialize all built-in agent wrappers', false)
    .option('-l, --list', 'List available built-in agents and their status', false)
    .option('-f, --force', 'Overwrite existing wrapper scripts', false)
    .option('-n, --dry-run', 'Show what would be created without writing', false)
    .action((agent: string | undefined, opts: Record<string, unknown>) => {
      try {
        const results = runInit({
          agent,
          all: opts.all as boolean,
          list: opts.list as boolean,
          force: opts.force as boolean,
          dryRun: opts.dryRun as boolean,
        });
        console.log(formatInitResults(results));

        const created = results.filter((r) => r.action === 'created').length;
        const skipped = results.filter((r) => r.action === 'skipped').length;
        const wouldCreate = results.filter((r) => r.action === 'would_create').length;
        const summary = [
          created > 0 ? `${created} created` : '',
          skipped > 0 ? `${skipped} skipped` : '',
          wouldCreate > 0 ? `${wouldCreate} would be created` : '',
        ]
          .filter(Boolean)
          .join(', ');
        if (summary) {
          console.log(`\n[at] init: ${summary}`);
        }
      } catch (err) {
        console.error(`[at] error: ${(err as Error).message}`);
        process.exit(1);
      }
    });
}
