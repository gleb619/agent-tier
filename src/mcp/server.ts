import { readFileSync } from "node:fs";
import * as path from "node:path";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { AT_TOOLS, handleToolCall } from "./tools";

function getVersion(): string {
  try {
    const pkg = JSON.parse(readFileSync(path.join(__dirname, "..", "..", "package.json"), "utf8")) as {
      version: string;
    };
    return pkg.version;
  } catch {
    return "0.0.0";
  }
}

/**
 * Build and connect the `at` MCP server.
 *
 * `transport` defaults to the production stdio transport but is injectable so
 * tests can wire an in-memory transport (no real stdio, no spawned process).
 */
export async function startMcpServer(
  stateDir: string,
  transport: InstanceType<typeof StdioServerTransport> = new StdioServerTransport(),
): Promise<void> {
  const server = new Server({ name: "at", version: getVersion() }, { capabilities: { tools: {} } });

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: AT_TOOLS }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    return handleToolCall(request.params.name, request.params.arguments ?? {}, stateDir);
  });

  await server.connect(transport);
  process.stderr.write("[at] MCP server ready on stdio\n");
}
