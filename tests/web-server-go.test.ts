// Go backend wrapper for the WebUI REST contract (T30): the new at-web is a
// thin proxy in front of `at bridge` (docs/bridge.md). The fake `at` CLI
// stands in for the real binary — it speaks the bridge subcommand (resources
// / verbs the proxy actually uses) and the `agents --json` / `enable` /
// `disable` legacy paths the dashboard still depends on. Builds the binary
// on demand; skips the whole suite when the Go toolchain is unavailable.
import { execFileSync, spawn } from "node:child_process";
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, vi } from "vitest";
import { type ContractTarget, describeWebApiContract, describeWebApiSSEContract } from "./web-contract";

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

// Fake `at` CLI (T30): records every argv to AT_CAPTURE (one JSON array per
// line). Implements the bridge resources the proxy calls AND the legacy
// `agents --json` / `enable|disable` paths the dashboard still needs. State
// is loaded from / written to AT_STATE_DIR (== stateDir passed by the
// contract harness).
const FAKE_AT = `#!/usr/bin/env node
const fs = require("fs");
const path = require("path");

const args = process.argv.slice(2);
function capture() {
  if (process.env.AT_CAPTURE) fs.appendFileSync(process.env.AT_CAPTURE, JSON.stringify(args) + "\\n");
}
capture();

const STATE = process.env.AT_STATE_DIR || process.cwd();
const runsFile = () => path.join(STATE, "runs.jsonl");
const stateFile = () => path.join(STATE, "state.json");
const eventsDir = () => path.join(STATE, "events");

function readRuns() {
  try { return fs.readFileSync(runsFile(), "utf8").trim().split("\\n").filter(Boolean).map((l) => JSON.parse(l)); }
  catch { return []; }
}
function readState() {
  try { return JSON.parse(fs.readFileSync(stateFile(), "utf8")); } catch { return { agents: {}, runs: [] }; }
}
// agents list: prefer AT_AGENTS_FILE (the test-registered set), else
// fall back to a builtin-style entry that mirrors 'at agents --json'.
function defaultAgents() {
  if (process.env.AT_AGENTS_FILE) {
    try { return JSON.parse(fs.readFileSync(process.env.AT_AGENTS_FILE, "utf8")); }
    catch { return []; }
  }
  return [{ tier: 4, name: "mock", deactivated: false, failures: 0, lastFailure: null, disabledTo: null }];
}
function appendDiscuss(runId, entry) {
  const dir = eventsDir();
  fs.mkdirSync(dir, { recursive: true });
  fs.appendFileSync(path.join(dir, runId + ".discuss.jsonl"), JSON.stringify(entry) + "\\n");
}
function appendEvent(runId, ev) {
  const dir = eventsDir();
  fs.mkdirSync(dir, { recursive: true });
  fs.appendFileSync(path.join(dir, runId + ".jsonl"), JSON.stringify(ev) + "\\n");
}

function readStdin() {
  return new Promise((resolve) => {
    let buf = "";
    process.stdin.on("data", (c) => (buf += c.toString()));
    process.stdin.on("end", () => resolve(buf));
  });
}

function ok(data) {
  return { ok: true, data };
}
function err(code, message) {
  return { error: { code, message } };
}

async function main() {
  if (args[0] === "bridge") {
    const [, resource, verb, id] = args;
    const raw = await readStdin();
    let params = {};
    if (raw.trim()) {
      try { params = JSON.parse(raw); } catch { console.log(JSON.stringify(err("BAD_JSON", "invalid stdin"))); process.exit(2); }
    }
    const reply = (payload, exit = 0) => { console.log(JSON.stringify(payload)); process.exit(exit); };

    if (resource === "ping" && verb === "ping") return reply(ok({ version: "test-9.9.9" }));

    if (resource === "agents") {
      if (verb === "list") return reply(ok(defaultAgents()));
      if (verb === "health") {
        // Same surface as agents list, but expose only the health fields
        // (mirrors docs/bridge.md for the 'agents health' verb).
        const agents = defaultAgents().map((a) => ({
          name: a.name,
          deactivated: a.deactivated,
          failures: a.failures,
          lastFailure: a.lastFailure,
          disabledTo: a.disabledTo,
        }));
        return reply(ok(agents));
      }
      return reply(err("USAGE", "unknown verb " + verb), 2);
    }

    if (resource === "runs") {
      if (verb === "list") {
        const all = readRuns();
        // Newest first — same shape at-status returns (src/run-store).
        all.sort((a, b) => (b.startedAt || "").localeCompare(a.startedAt || ""));
        return reply(ok(all));
      }
      if (verb === "get") {
        const lookup = id || params.id;
        const all = readRuns();
        const found = all.find((r) => r.runId === lookup) || all.find((r) => r.runId && r.runId.startsWith(lookup));
        if (!found) return reply(err("NOT_FOUND", "run not found"), 3);
        return reply(ok(found));
      }
      if (verb === "stop") {
        const lookup = id || params.id;
        const all = readRuns();
        const idx = all.findIndex((r) => r.runId === lookup);
        if (idx === -1) return reply(err("NOT_FOUND", "run not found"), 3);
        const r = all[idx];
        if (r.pid) {
          try { process.kill(r.pid, params.force ? "SIGKILL" : "SIGTERM"); } catch {}
        }
        r.status = "failed";
        r.finishedAt = new Date().toISOString();
        all[idx] = r;
        fs.writeFileSync(runsFile(), all.map((x) => JSON.stringify(x)).join("\\n") + "\\n");
        return reply(ok({ runId: lookup, pid: r.pid, signal: params.force ? "SIGKILL" : "SIGTERM", alive: false, stopped: true }));
      }
      return reply(err("USAGE", "unknown verb " + verb), 2);
    }

    if (resource === "discuss") {
      if (verb === "list") {
        const lookup = id || params.runId;
        const all = readRuns();
        if (!all.find((r) => r.runId === lookup || r.runId?.startsWith(lookup))) return reply(err("NOT_FOUND", "run not found"), 3);
        const file = path.join(eventsDir(), lookup + ".discuss.jsonl");
        let entries = [];
        try { entries = fs.readFileSync(file, "utf8").trim().split("\\n").filter(Boolean).map((l) => JSON.parse(l)); } catch {}
        if (params.pending) entries = entries.filter((e) => e.kind === "question" && !entries.some((a) => a.kind === "answer" && a.replyTo === e.id));
        return reply(ok(entries));
      }
      if (verb === "say" || verb === "answer") {
        const lookup = id || params.runId;
        const all = readRuns();
        if (!all.find((r) => r.runId === lookup)) return reply(err("NOT_FOUND", "run not found"), 3);
        const file = path.join(eventsDir(), lookup + ".discuss.jsonl");
        let entries = [];
        try { entries = fs.readFileSync(file, "utf8").trim().split("\\n").filter(Boolean).map((l) => JSON.parse(l)); } catch {}
        const nextId = "m" + (entries.length + 1);
        const entry = {
          id: nextId,
          from: "host",
          kind: verb === "answer" ? "answer" : "say",
          text: params.text,
          replyTo: params.replyTo,
          ts: new Date().toISOString(),
        };
        appendDiscuss(lookup, entry);
        appendEvent(lookup, { runId: lookup, agent: "mock", ts: entry.ts, seq: entries.length + 1, type: "message", text: entry.text, data: { kind: entry.kind, replyTo: entry.replyTo } });
        return reply(ok({ id: nextId }), 0);
      }
      return reply(err("USAGE", "unknown verb " + verb), 2);
    }

    if (resource === "events" && verb === "tail") {
      const lookup = id || params.id || params.runId;
      const dir = eventsDir();
      let entries = [];
      try {
        if (lookup) {
          const file = path.join(dir, lookup + ".jsonl");
          entries = fs.readFileSync(file, "utf8").trim().split("\\n").filter(Boolean).map((l) => JSON.parse(l));
        } else {
          for (const f of fs.readdirSync(dir)) {
            if (f.endsWith(".jsonl")) entries = entries.concat(fs.readFileSync(path.join(dir, f), "utf8").trim().split("\\n").filter(Boolean).map((l) => JSON.parse(l)));
          }
          entries.sort((a, b) => (a.seq || 0) - (b.seq || 0));
        }
      } catch {}
      const since = Number(params.since || 0);
      if (since) entries = entries.filter((e) => (e.seq || 0) > since);
      return reply(ok(entries));
    }

    if (resource === "status" && verb === "get") {
      const all = readRuns();
      return reply(ok({ total: all.length, runs: all, state: readState() }));
    }

    if (resource === "health" && verb === "get") return reply(ok(readState()));

    if (resource === "config" && verb === "get") return reply(ok({}));

    return reply(err("USAGE", "unknown resource/verb " + resource + "/" + verb), 2);
  }

  if (args[0] === "agents" && args[1] === "--json") {
    const payload = process.env.AT_AGENTS_FILE
      ? fs.readFileSync(process.env.AT_AGENTS_FILE, "utf8")
      : "[]";
    process.stdout.write(payload);
    return;
  }
  if ((args[0] === "enable" || args[0] === "disable") && args[1]) {
    const file = process.env.AT_AGENTS_FILE;
    if (!file) process.exit(0);
    const agents = JSON.parse(fs.readFileSync(file, "utf8"));
    const agent = agents.find((a) => a.name === args[1]);
    if (!agent) { console.error("Unknown agent: " + args[1]); process.exit(1); }
    agent.deactivated = args[0] === "disable";
    fs.writeFileSync(file, JSON.stringify(agents, null, 2));
    return;
  }
  // Unknown invocation — exit 0 silently so detached spawns don't block.
}

main().catch((e) => { console.error(e); process.exit(1); });
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
  describe.skip("web server contract (go)", () => {
    it.skip("skipped: Go toolchain or at-web build unavailable", () => {});
  });
} else {
  const describeWebApiContractHooks = {
    async start(stateDir) {
      const fakeAt = path.join(stateDir, "fake-at.js");
      const captureFile = path.join(stateDir, "at-capture.jsonl");
      const agentsFile = path.join(stateDir, "at-agents.json");
      writeFileSync(fakeAt, FAKE_AT);
      chmodSync(fakeAt, 0o755);
      writeFileSync(agentsFile, CANNED_AGENTS);

      const proc = spawn(built!.bin, ["--port", "0", "--host", "127.0.0.1", "--static", stateDir], {
        env: {
          ...process.env,
          AT_BIN: fakeAt,
          AT_CAPTURE: captureFile,
          AT_AGENTS_FILE: agentsFile,
          AT_STATE_DIR: stateDir,
        },
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
      // synchronous bridge/agents/enable/disable calls (they have distinct argv).
      return readFileSync(t.__captureFile, "utf8")
        .trim()
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line) as string[])
        .filter(
          (args) => args[0] !== "bridge" && args[0] !== "agents" && args[0] !== "enable" && args[0] !== "disable",
        );
    },
  };

  describeWebApiContract("web server contract (go)", describeWebApiContractHooks);

  describeWebApiSSEContract("web server sse contract (go)", {
    async start(stateDir) {
      const t = await describeWebApiContractHooks.start(stateDir);
      return {
        baseUrl: t.baseUrl,
        async close() {
          await t.close();
        },
      };
    },
    async spawnedArgs(target) {
      return await describeWebApiContractHooks.spawnedArgs(target as GoTarget);
    },
  });
}
