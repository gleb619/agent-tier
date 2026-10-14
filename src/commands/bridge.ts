import type { Command } from "commander";
import { dispatchBridge, listBridgeResources } from "../bridge";
import type { BridgeParams } from "../bridge/types";
import { BridgeError } from "../bridge/types";
import { resolveStatusDirs } from "../state-dir";

/**
 * `at bridge <resource> <verb> [id]` — machine-readable JSON RPC surface.
 * Contract: docs/bridge.md. stdin = JSON params, stdout = JSON envelope only.
 */

async function readStdin(): Promise<string> {
  if (process.stdin.isTTY) return "";
  return new Promise((resolve) => {
    let data = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => (data += chunk));
    process.stdin.on("end", () => resolve(data.trim()));
  });
}

function parseParams(stdin: string): BridgeParams {
  if (!stdin) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdin);
  } catch {
    throw new BridgeError("BAD_JSON", "stdin must be a JSON object (e.g. {})", 2);
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new BridgeError("BAD_JSON", "stdin JSON must be an object", 2);
  }
  return parsed as BridgeParams;
}

function writeEnvelope(envelope: unknown): void {
  process.stdout.write(`${JSON.stringify(envelope)}\n`);
}

export function registerBridgeCommand(program: Command): void {
  program
    .command("bridge [resource] [verb] [id]")
    .description("Machine-readable JSON RPC surface: stdin = JSON params, stdout = JSON envelope (docs/bridge.md)")
    .action(async (resource: string | undefined, verb: string | undefined, id: string | undefined) => {
      try {
        if (!resource || !verb) {
          throw new BridgeError(
            "USAGE",
            `usage: at bridge <resource> <verb> [id]  (resources: ${listBridgeResources().join(", ")})`,
            2,
          );
        }
        const params = parseParams(await readStdin());
        if (id !== undefined && params.id === undefined) {
          params.id = id;
        }
        const data = await Promise.resolve(
          dispatchBridge(resource, verb, params, { stateDirs: resolveStatusDirs() }),
        );
        writeEnvelope({ ok: true, data });
      } catch (err) {
        if (err instanceof BridgeError) {
          writeEnvelope({ error: { code: err.code, message: err.message } });
          process.exit(err.exitCode);
        }
        const message = err instanceof Error ? err.message : String(err);
        console.error(`[at] error: ${message}`);
        writeEnvelope({ error: { code: "INTERNAL", message } });
        process.exit(3);
      }
    });
}
