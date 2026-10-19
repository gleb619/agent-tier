import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const ROOT = path.resolve(__dirname, "..");
const SCRIPT = path.join(ROOT, "scripts", "reload-at-web.sh");

function runScript(args: string[], env?: Record<string, string>): { status: number; out: string } {
  const result = spawnSync("bash", [SCRIPT, ...args], {
    encoding: "utf8",
    cwd: ROOT,
    env: { ...process.env, ...env },
  });
  return {
    status: result.status ?? -1,
    out: `${result.stdout ?? ""}${result.stderr ?? ""}`,
  };
}

let tmpDirs: string[] = [];
afterEach(() => {
  for (const d of tmpDirs) {
    rmSync(d, { recursive: true, force: true });
  }
  tmpDirs = [];
});

function makeTmp(): string {
  const d = mkdtempSync(path.join(os.tmpdir(), "reload-at-web-"));
  tmpDirs.push(d);
  return d;
}

describe("reload-at-web script", () => {
  it("exists and is executable", () => {
    expect(existsSync(SCRIPT)).toBe(true);
    const mode = execFileSync("stat", ["-c", "%a", SCRIPT], { encoding: "utf8" }).trim();
    expect(Number(mode) % 2).toBe(1);
  });

  it("passes bash -n syntax check", () => {
    expect(() => execFileSync("bash", ["-n", SCRIPT])).not.toThrow();
  });

  it("prints usage for --help and exits 0", () => {
    const r = runScript(["--help"]);
    expect(r.status).toBe(0);
    expect(r.out).toMatch(/Usage:/);
  });

  it("rejects unknown options with exit code 2", () => {
    const r = runScript(["--bogus"]);
    expect(r.status).toBe(2);
  });

  it("dry-run writes both service files pointing at the repo and tunnelstack", () => {
    const systemdDir = makeTmp();
    const tunnelstack = makeTmp();
    const r = runScript(["--dry-run", "--no-build", tunnelstack], {
      SYSTEMD_USER_DIR: systemdDir,
    });
    expect(r.status).toBe(0);
    expect(r.out).toContain(`[dry-run] wrote ${path.join(systemdDir, "at-web.service")}`);
    expect(r.out).toContain(`[dry-run] wrote ${path.join(systemdDir, "at-gateway.service")}`);

    const web = readFileSync(path.join(systemdDir, "at-web.service"), "utf8");
    const gateway = readFileSync(path.join(systemdDir, "at-gateway.service"), "utf8");

    expect(web).toContain(`WorkingDirectory=${ROOT}`);
    expect(web).toContain(`ExecStart=${ROOT}/bin/at-web`);
    expect(web).toContain(`--static ${ROOT}/src/webui/dist`);
    expect(web).toContain(`ConditionPathExists=!${tunnelstack}/.tunnelstack-paused`);
    expect(gateway).toContain(`WorkingDirectory=${tunnelstack}`);
    expect(gateway).toContain(`ExecStart=/usr/bin/python3 ${tunnelstack}/projects/agenttier/at_gateway.py`);
    expect(gateway).toContain("After=at-web.service");
  });

  it("defaults tunnelstack project to /home/boris/tunnelstack", () => {
    const systemdDir = makeTmp();
    const r = runScript(["--dry-run", "--no-build"], {
      SYSTEMD_USER_DIR: systemdDir,
    });
    expect(r.status).toBe(0);
    const gateway = readFileSync(path.join(systemdDir, "at-gateway.service"), "utf8");
    expect(gateway).toContain("WorkingDirectory=/home/boris/tunnelstack");
    expect(gateway).toContain("/home/boris/tunnelstack/projects/agenttier/at_gateway.py");
  });

  it("errors when tunnelstack project does not exist", () => {
    const r = runScript(["--dry-run", "--no-build", "/nonexistent/tunnelstack"]);
    expect(r.status).toBe(1);
    expect(r.out).toContain("tunnelstack project not found");
  });
});
