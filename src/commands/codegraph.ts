import { Command } from 'commander';
import { spawn } from 'child_process';
import { execFile as _execFile } from 'child_process';
import { promisify } from 'util';
const execFileAsync = promisify(_execFile);

function getCodegraphBin(): string {
  return process.env.CODEGRAPH_BIN || 'codegraph';
}

function runCodegraph(args: string[]): void {
  const bin = getCodegraphBin();
  const child = spawn(bin, args, { stdio: 'inherit' });
  child.on('error', (err) => {
    console.error(`[at] failed to spawn codegraph: ${err.message}`);
    process.exit(1);
  });
  child.on('exit', (code) => process.exit(code ?? 1));
}

export async function getCodegraphContext(task: string, maxNodes = 30): Promise<string> {
  const bin = getCodegraphBin();
  try {
    const { stdout } = await execFileAsync(bin, ['context', task, '--max-nodes', String(maxNodes)]);
    return stdout || '[codegraph context: empty result]';
  } catch (err) {
    return `[codegraph context unavailable: ${err instanceof Error ? err.message : String(err)}]`;
  }
}

export function registerCodegraphCommand(program: Command): void {
  const index = program
    .command('index')
    .description('Semantic code knowledge graph via CodeGraph');

  index
    .command('init [path]')
    .description('Initialize a project for CodeGraph indexing')
    .option('-i, --interactive', 'Interactive initialization + indexing')
    .action((path: string | undefined, opts: Record<string, unknown>) => {
      const args = path ? ['init', path] : ['init'];
      if (opts.interactive) args.push('-i');
      runCodegraph(args);
    });

  index
    .command('index [path]')
    .description('Full index of the codebase')
    .option('--force', 'Re-index from scratch')
    .option('--quiet', 'Suppress non-essential output')
    .action((path: string | undefined, opts: Record<string, unknown>) => {
      const args = path ? ['index', path] : ['index'];
      if (opts.force) args.push('--force');
      if (opts.quiet) args.push('--quiet');
      runCodegraph(args);
    });

  index
    .command('sync [path]')
    .description('Incremental sync of changed files')
    .action((path: string | undefined) => {
      runCodegraph(path ? ['sync', path] : ['sync']);
    });

  index
    .command('status [path]')
    .description('Show index stats (files, nodes, edges, backend type)')
    .action((path: string | undefined) => {
      runCodegraph(path ? ['status', path] : ['status']);
    });

  index
    .command('query <search>')
    .description('Search symbols by name')
    .option('--kind <kind>', 'Filter by symbol kind (class, method, function, etc.)')
    .option('--limit <number>', 'Max results', (v) => parseInt(v, 10))
    .option('--json', 'Output JSON')
    .action((search: string, opts: Record<string, unknown>) => {
      const args = ['query', search];
      if (opts.kind) args.push('--kind', String(opts.kind));
      if (opts.limit) args.push('--limit', String(opts.limit));
      if (opts.json) args.push('--json');
      runCodegraph(args);
    });

  index
    .command('files')
    .description('Show indexed file structure')
    .action(() => runCodegraph(['files']));

  index
    .command('context <task>')
    .description('Build markdown context for an AI task')
    .option('--max-nodes <number>', 'Max nodes to include', (v) => parseInt(v, 10))
    .action((task: string, opts: Record<string, unknown>) => {
      const args = ['context', task];
      if (opts.maxNodes) args.push('--max-nodes', String(opts.maxNodes));
      runCodegraph(args);
    });

  index
    .command('affected [files...]')
    .description('Find test files affected by changed source files')
    .action((files: string[] | undefined) => {
      runCodegraph(files && files.length > 0 ? ['affected', ...files] : ['affected']);
    });

  index
    .command('serve')
    .description('Start the CodeGraph server')
    .option('--mcp', 'Run as MCP server')
    .action((opts: Record<string, unknown>) => {
      const args = ['serve'];
      if (opts.mcp) args.push('--mcp');
      runCodegraph(args);
    });
}
