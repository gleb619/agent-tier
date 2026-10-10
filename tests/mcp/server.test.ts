import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { AT_TOOLS, handleToolCall } from '../../src/mcp/tools';

interface Watcher {
  stderr: string;
  restore: () => void;
}

function watchStderr(): Watcher {
  const origWrite = process.stderr.write.bind(process.stderr);
  let buf = '';
  (process.stderr.write as unknown) = ((s: string | Buffer): boolean => {
    buf += String(s);
    return true;
  });
  return {
    get stderr() { return buf; },
    restore: () => {
      (process.stderr.write as unknown) = origWrite;
    },
  } as Watcher;
}

/**
 * Stand up an MCP server backed by an in-memory transport pair.
 * Returns the connected client. Mirrors what `startMcpServer` does
 * internally but skips the stdio binding + the noisy `[at] MCP server
 * ready on stdio` line on stderr.
 */
async function setupServer(stateDir: string): Promise<Client> {
  const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();

  const server = new Server(
    { name: 'at', version: '0.0.0-test' },
    { capabilities: { tools: {} } },
  );
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: AT_TOOLS }));
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    return handleToolCall(request.params.name, request.params.arguments ?? {}, stateDir);
  });

  await server.connect(serverTransport);

  const client = new Client(
    { name: 'test-client', version: '0.0.0-test' },
    { capabilities: {} },
  );
  await client.connect(clientTransport);
  return client;
}

function expectSuccess(result: { content: { type: string; text: string }[]; isError?: boolean }): unknown {
  expect(result.isError).toBeFalsy();
  expect(result.content).toHaveLength(1);
  expect(result.content[0].type).toBe('text');
  return JSON.parse(result.content[0].text);
}

describe('MCP server (in-memory transport)', () => {
  let stateDir: string;
  let stderrWatch: Watcher;

  beforeEach(() => {
    stateDir = mkdtempSync(path.join(tmpdir(), 'at-mcp-'));
    writeFileSync(path.join(stateDir, 'state.json'), '{}', 'utf8');
    // Suppress the `[at] MCP server ready on stdio` line + any namer noise
    // emitted from inside tool calls.
    stderrWatch = watchStderr();
  });

  afterEach(async () => {
    stderrWatch.restore();
    rmSync(stateDir, { recursive: true, force: true });
    // Give any background timers a chance to clear before the next test.
    await new Promise((r) => setTimeout(r, 10));
  });

  // ── list_tools ─────────────────────────────────────────────────────────

  it('lists all 5 tools with valid schemas', async () => {
    const client = await setupServer(stateDir);
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name).sort();
    expect(names).toEqual(['disable_agent', 'enable_agent', 'get_status', 'list_agents', 'run_prompt']);
    for (const t of tools) {
      expect(t.inputSchema).toBeDefined();
      expect((t.inputSchema as { type: string }).type).toBe('object');
    }
  });

  // ── list_agents ────────────────────────────────────────────────────────

  it('list_agents returns registered agents with tier + health fields', async () => {
    const client = await setupServer(stateDir);
    const result = await client.callTool({ name: 'list_agents', arguments: {} });
    const agents = expectSuccess(result) as Array<{ name: string; tier: number; deactivated: boolean; healthy: boolean }>;
    expect(Array.isArray(agents)).toBe(true);
    expect(agents.length).toBeGreaterThan(0);
    const mock = agents.find((a) => a.name === 'mock');
    expect(mock).toBeDefined();
    expect(mock?.tier).toBe(4);
    expect(typeof mock?.deactivated).toBe('boolean');
    expect(typeof mock?.healthy).toBe('boolean');
  });

  it('list_agents honours tier filter', async () => {
    const client = await setupServer(stateDir);
    const result = await client.callTool({ name: 'list_agents', arguments: { tier: 4 } });
    const agents = expectSuccess(result) as Array<{ name: string; tier: number }>;
    expect(agents.every((a) => a.tier === 4)).toBe(true);
    expect(agents.map((a) => a.name)).toEqual(['mock', 'mock-long']);
  });

  // ── get_status ─────────────────────────────────────────────────────────

  it('get_status returns an empty list when no runs are recorded', async () => {
    const client = await setupServer(stateDir);
    const result = await client.callTool({ name: 'get_status', arguments: {} });
    const runs = expectSuccess(result);
    expect(Array.isArray(runs)).toBe(true);
    expect(runs).toEqual([]);
  });

  it('get_status honours the limit argument', async () => {
    const client = await setupServer(stateDir);
    const result = await client.callTool({ name: 'get_status', arguments: { limit: 1 } });
    const runs = expectSuccess(result);
    expect(Array.isArray(runs)).toBe(true);
    expect((runs as unknown[]).length).toBeLessThanOrEqual(1);
  });

  // ── disable_agent / enable_agent ───────────────────────────────────────

  it('disable_agent flips deactivated flag, enable_agent restores it', async () => {
    const client = await setupServer(stateDir);

    // 1. Disable
    const disableResult = await client.callTool({
      name: 'disable_agent',
      arguments: { agent: 'mock' },
    });
    const disabledMsg = expectSuccess(disableResult) as { message: string };
    expect(disabledMsg.message).toContain('disabled');

    // 2. list_agents reflects the flip
    const after = await client.callTool({ name: 'list_agents', arguments: { tier: 4 } });
    const agents = expectSuccess(after) as Array<{ name: string; deactivated: boolean }>;
    const mock = agents.find((a) => a.name === 'mock');
    expect(mock?.deactivated).toBe(true);

    // 3. Enable
    const enableResult = await client.callTool({
      name: 'enable_agent',
      arguments: { agent: 'mock' },
    });
    const enabledMsg = expectSuccess(enableResult) as { message: string };
    expect(enabledMsg.message).toContain('enabled');

    // 4. list_agents shows the flip is reverted
    const after2 = await client.callTool({ name: 'list_agents', arguments: { tier: 4 } });
    const agents2 = expectSuccess(after2) as Array<{ name: string; deactivated: boolean }>;
    expect(agents2.find((a) => a.name === 'mock')?.deactivated).toBe(false);
  });

  it('disable_agent persists across separate client connections', async () => {
    // First client: disable
    const c1 = await setupServer(stateDir);
    await c1.callTool({ name: 'disable_agent', arguments: { agent: 'mock' } });

    // Second client: should observe the persisted state
    const c2 = await setupServer(stateDir);
    const after = await c2.callTool({ name: 'list_agents', arguments: { tier: 4 } });
    const agents = expectSuccess(after) as Array<{ name: string; deactivated: boolean }>;
    expect(agents.find((a) => a.name === 'mock')?.deactivated).toBe(true);

    // Clean up so we don't leak state between test files
    await c2.callTool({ name: 'enable_agent', arguments: { agent: 'mock' } });
  });

  // ── run_prompt with tier-4 mock agent ───────────────────────────────────

  it('run_prompt with tier-4 mock agent spawns mock-agent and returns success', async () => {
    // Sanity check: the mock binary must exist for this test to mean anything
    // (registry.ts defaults to $LOCAL_BIN/mock-agent). Skip rather than fail
    // if it isn't on this machine.
    const mockPath = path.join(process.env.HOME ?? '', '.local', 'bin', 'mock-agent');
    if (!existsSync(mockPath)) {
      return;
    }

    const client = await setupServer(stateDir);
    const result = await client.callTool({
      name: 'run_prompt',
      arguments: { prompt: 'hello from mcp test', tier: 4, agent: 'mock' },
    });

    const parsed = expectSuccess(result) as {
      success: boolean;
      agent: string;
      exitCode: number;
      logFile: string;
      runId: string;
    };
    expect(parsed.success).toBe(true);
    expect(parsed.agent).toBe('mock');
    expect(parsed.exitCode).toBe(0);
    expect(parsed.runId).toMatch(/^[a-z]+-[a-z]+-[a-z0-9]+-[a-z0-9]+$/);
    expect(parsed.logFile).toContain('/tmp/at-mcp-logs/');

    // The run record should be persisted in our tmp stateDir
    const runsFile = path.join(stateDir, 'runs.jsonl');
    expect(existsSync(runsFile)).toBe(true);
  }, 30_000);

  it('run_prompt with unknown agent returns an error result', async () => {
    const client = await setupServer(stateDir);
    const result = await client.callTool({
      name: 'run_prompt',
      arguments: { prompt: 'hi', tier: 4, agent: 'no-such-agent' },
    });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/no such|no-such-agent|unknown/i);
  });

  it('unknown tool name returns an error result', async () => {
    const client = await setupServer(stateDir);
    const result = await client.callTool({
      name: 'no_such_tool',
      arguments: {},
    });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Unknown tool');
  });
});