import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Command } from "commander";
import {
  agentBinCandidates,
  type BinResolution,
  cachedBinResolution,
  cacheStats,
  type DaemonCacheStats,
} from "../daemon-cache";

function atdSock(): string {
  const home = os.homedir();
  const dir = process.env.AT_STATE_DIR || path.join(home, ".at");
  return path.join(dir, "atd.sock");
}

function atdPid(): string {
  const home = os.homedir();
  const dir = process.env.AT_STATE_DIR || path.join(home, ".at");
  return path.join(dir, "atd.pid");
}

export function registerDaemonCommand(program: Command): void {
  const cmd = program.command("daemon").description("Daemon core (atd)");
  cmd
    .command("start")
    .description("Start atd daemon")
    .action(() => {
      const bin = process.env.AT_DAEMON_BIN || "atd";
      const child = spawn(bin, ["--idle-ms", "300000"], {
        detached: true,
        stdio: "ignore",
        env: process.env,
      });
      child.unref();
      console.log("[at] daemon started (pid", child.pid, ")");
    });
  cmd
    .command("stop")
    .description("Stop atd daemon")
    .action(() => {
      const sock = atdSock();
      if (!existsSync(sock)) {
        console.log("[at] daemon not running (no sock)");
        return;
      }
      try {
        const net = require("node:net");
        const conn = net.connect({ path: sock });
        conn.write(`${JSON.stringify({ cmd: "stop", version: "0.1.0" })}\n`);
        conn.on("close", () => console.log("[at] daemon stopped"));
        conn.end();
      } catch (err) {
        console.error("[at] daemon stop failed:", err);
      }
    });
  cmd
    .command("status")
    .description("Daemon status")
    .action(() => {
      const pidFile = atdPid();
      const sock = atdSock();
      if (!existsSync(sock)) {
        console.log("[at] daemon not running (no sock)");
        return;
      }
      try {
        if (existsSync(pidFile)) {
          const pid = readFileSync(pidFile, "utf8").trim();
          console.log("[at] daemon running pid", pid, "sock", sock);
        } else {
          console.log("[at] daemon sock exists but no pidfile");
        }
      } catch (err) {
        console.error("[at] daemon status error:", err);
      }
    });
  cmd
    .command("cache")
    .description("Daemon hot caches: read/miss counters + resolved agent bins")
    .action(async () => {
      try {
        const [stats, bins] = await Promise.all([cacheStats(), cachedBinResolution(agentBinCandidates())]);
        console.log(formatCacheReport(stats, bins));
      } catch (err) {
        console.error("[at] daemon cache error:", err);
        process.exit(1);
      }
    });
}

const BIN_MISSING = "<missing>";

/**
 * Render the daemon's hot-cache state for `at daemon cache`. Null stats means
 * the daemon did not answer (not running, or caches disabled) — say so instead
 * of implying an empty cache, which would read as "nothing invalidated".
 */
export function formatCacheReport(stats: DaemonCacheStats | null, bins: BinResolution | null): string {
  if (!stats) return "[at] daemon not running (no hot cache data)";

  const lines = [
    "# Hot caches",
    "",
    `hits: ${stats.hits}  misses: ${stats.misses}  invalidations: ${stats.invalidations}  entries: ${stats.entries}`,
    `watched: ${stats.watched.length > 0 ? stats.watched.join(", ") : "(none)"}`,
  ];

  if (!bins) {
    lines.push("", `[at] daemon is not serving bin resolution (no data)`);
    return lines.join("\n");
  }

  const names = Object.keys(bins).sort();
  const width = Math.max(...names.map((n) => n.length), 4);
  lines.push("", "Agent bins:");
  for (const name of names) {
    lines.push(`  ${name.padEnd(width)}  ${bins[name] ?? BIN_MISSING}`);
  }
  return lines.join("\n");
}
