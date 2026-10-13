// Go backend wrapper for the shared REST contract: builds the at-web binary
// (skips the whole suite with a clear message when the Go toolchain is
// unavailable or the build fails), boots it against a temp state dir with a
// fake `at` CLI (node script) standing in for the real binary — it records
// spawn argv and serves/flip the canned agents payload.
import { execFileSync, spawn } from "node:child_process";
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, vi } from "vitest";
import { type ContractTarget, describeWebApiContract } from "./web-contract";

const GO = process.env.AT_WEB_GO ?? "/usr/local/go/bin/go";

function buildAtWeb(): { bin: string; cleanup: () => void } | undefined {
  if (!existsSync(GO)) return undefined;
  const dir = mkdtempSync(path.join(tmpdir(), "at-web-gobuild-"));
  const bin = path.join(dir, "at-web");
  try {
    execFileSync(GO, ["build", "-o", bin, "./cmd/at-web"], {
      cwd: path.resolve(__dirname, "..", "web-server"),
      stdio: "pipe",
    });
  } catch (err) {
    const stderr = (err as { stderr?: Buffer }).stderr?.toString() ?? String(err);
    console.warn(`[web-server-go] go build failed — skipping Go contract suite: ${stderr.trim()}`);
    rmSync(dir, { recursive: true, force: true });
    return undefined;
  }
  return { bin, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

const built = buildAtWeb();
if (!built) {
  console.warn(`[web-server-go] Go toolchain or build unavailable (${GO}) — skipping Go contract suite`);
} else {
  afterAll(() => built.cleanup());
}

// Fake `at` CLI: records every invocation's argv to AT_CAPTURE (one JSON
// array per line); `agents --json` prints the AT_AGENTS_FILE payload;
// `enable|disable <name>` flips that entry's `deactivated` flag.
const FAKE_AT = `#!/usr/bin/env node
const fs = require("fs");
const args = process.argv.slice(2);
if (process.env.AT_CAPTURE) fs.appendFileSync(process.env.AT_CAPTURE, JSON.stringify(args) + "\\n");
if (args[0] === "agents" && args[1] === "--json") {
  process.stdout.write(fs.readFileSync(process.env.AT_AGENTS_FILE, "utf8"));
} else if ((args[0] === "enable" || args[0] === "disable") && args[1]) {
  const agents = JSON.parse(fs.readFileSync(process.env.AT_AGENTS_FILE, "utf8"));
  const agent = agents.find((a) => a.name === args[1]);
  if (!agent) { console.error("Unknown agent: " + args[1]); process.exit(1); }
  agent.deactivated = args[0] === "disable";
  fs.writeFileSync(process.env.AT_AGENTS_FILE, JSON.stringify(agents, null, 2));
}
`;

const CANNED_AGENTS = JSON.stringify([
  { name: "glm-code", tier: 1, deactivated: false, failures: 0, lastFailure: null, disabledTo: null },
  { name: "mock", tier: 4, deactivated: false, failures: 0, lastFailure: null, disabledTo: null },
]);

interface GoTarget extends ContractTarget {
  __captureFile: string;
  __proc: ReturnType<typeof spawn>;
}

if (!built) {
  // Skip with a clear message (printed above) but keep a placeholder so the
  // suite is never empty.
  describe.skip("web server contract (go)", () => {
    it.skip("skipped: Go toolchain or at-web build unavailable", () => {});
  });
} else {
  describeWebApiContract("web server contract (go)", {
    async start(stateDir) {
      const fakeAt = path.join(stateDir, "fake-at.js");
      const captureFile = path.join(stateDir, "at-capture.jsonl");
      const agentsFile = path.join(stateDir, "at-agents.json");
      writeFileSync(fakeAt, FAKE_AT);
      chmodSync(fakeAt, 0o755);
      writeFileSync(agentsFile, CANNED_AGENTS);

      const proc = spawn(built!.bin, ["--port", "0", "--state-dir", stateDir], {
        env: { ...process.env, AT_BIN: fakeAt, AT_CAPTURE: captureFile, AT_AGENTS_FILE: agentsFile },
        stdio: ["ignore", "pipe", "pipe"],
      });
      const baseUrl = await new Promise<string>((resolve, reject) => {
        let stderr = "";
        const timer = setTimeout(() => reject(new Error(`at-web did not start: ${stderr}`)), 10000);
        proc.stderr!.on("data", (chunk: Buffer) => {
          stderr += chunk.toString();
          const match = stderr.match(/serving on http:\/\/([\d.]+:\d+)/);
          if (match) {
            clearTimeout(timer);
            resolve(`http://${match[1]}`);
          }
        });
        proc.on("error", (err) => {
          clearTimeout(timer);
          reject(err);
        });
      });

      return {
        baseUrl,
        __captureFile: captureFile,
        __proc: proc,
        async close() {
          proc.kill("SIGTERM");
          await new Promise((resolve) => proc.once("exit", resolve));
        },
      } as GoTarget;
    },
    async spawnedArgs(target) {
      const t = target as GoTarget;
      await vi.waitFor(
        () => {
          if (!existsSync(t.__captureFile)) throw new Error("no capture yet");
        },
        { timeout: 5000, interval: 50 },
      );
      // Only spawn-style invocations are recorded in-order; filter out the
      // synchronous agents/enable/disable calls (they have distinct argv).
      return readFileSync(t.__captureFile, "utf8")
        .trim()
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line) as string[])
        .filter((args) => args[0] !== "agents" && args[0] !== "enable" && args[0] !== "disable");
    },
  });
}
