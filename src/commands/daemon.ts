import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Command } from "commander";

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
}
