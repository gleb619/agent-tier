import { Command } from 'commander';
import { signConfig } from '../config';

export function registerConfigCommand(program: Command): void {
  program
    .command('config sign')
    .description('Sign ~/.at/config.json with HMAC to prevent tampering')
    .action(() => {
      try {
        signConfig();
        console.log('[at] config signed');
      } catch (err) {
        console.error(`[at] error: ${(err as Error).message}`);
        process.exit(1);
      }
    });
}
