#!/usr/bin/env python3
"""resource-guard: protect the laptop from runaway `at` / build / test work.

Polls /proc every few seconds. Only touches processes that belong to agent-tier
work (cwd or cmdline under an `agent-tier*` path, or well-known build/test tools
whose cwd is there). Never touches the desktop, browsers, IDEs or claude itself.

Escalation (all thresholds env-overridable, see CONFIG):
  * system low memory      -> kill heaviest target tree
  * temperature >= PAUSE_C -> SIGSTOP all targets (cool-down), SIGCONT below RESUME_C
  * temperature >= KILL_C  -> kill all targets
  * one process tree over RSS limit, or sustained CPU over limit -> kill that tree
  * all targets together over aggregate CPU/RSS limits -> kill heaviest tree
  * paused longer than PAUSE_MAX_S -> kill (do not leave zombies of work frozen)

Usage: resource-guard.py [--dry-run] [--once]
Log:   ~/.local/state/at-guard/guard.log
"""
import glob
import os
import re
import signal
import subprocess
import sys
import time

CONFIG = {
    "INTERVAL_S": 3.0,
    "PROC_RSS_MAX_MB": 3072,      # one process tree
    "TREE_CPU_MAX_PCT": 300.0,    # one tree, 100 = one core
    "CPU_SUSTAIN_S": 40,
    "AGG_CPU_MAX_PCT": 450.0,     # all targets together (of nproc*100)
    "AGG_CPU_SUSTAIN_S": 60,
    "AGG_RSS_MAX_MB": 10240,
    "MIN_AVAIL_MB": 3072,         # system MemAvailable floor
    "PAUSE_C": 82.0,
    "RESUME_C": 72.0,
    "KILL_C": 92.0,
    "TEMP_SUSTAIN_S": 9,
    "PAUSE_MAX_S": 600,
    "TERM_GRACE_S": 5,
    "MAX_AT_RUNS": 6,             # fan-out breaker: concurrent `at` supervisors (run-watch.js)
}
for _k, _v in list(CONFIG.items()):
    _e = os.environ.get("AT_GUARD_" + _k)
    if _e:
        CONFIG[_k] = type(_v)(_e)

PATH_RE = re.compile(r"agent-tier")
TOOL_RE = re.compile(
    r"(^|/)(node|pnpm|npm|npx|tsc|vitest|biome|esbuild|vite|go|gofmt|cgo|compile|link|docker|chrome|chromium|"
    r"headless_shell|playwright|codex|kimi|opencode|qwen|mm-code|glm-code|cline|kilo|kiro|devin|at|bun)(\s|$)"
)
EXCLUDE_RE = re.compile(
    r"(claude|chrome-devtools-mcp|idea|Xorg|sddm|plasma|kwin|hermes|resource-guard|systemd|dbus|pipewire|NetworkManager|ncalayer)"
)
SELF = os.getpid()
NCPU = os.cpu_count() or 1
LOG = os.path.expanduser("~/.local/state/at-guard/guard.log")
DRY = "--dry-run" in sys.argv
os.makedirs(os.path.dirname(LOG), exist_ok=True)


def log(msg):
    line = time.strftime("%F %T ") + msg
    print(line, flush=True)
    try:
        with open(LOG, "a") as f:
            f.write(line + "\n")
        if os.path.getsize(LOG) > 2_000_000:
            os.replace(LOG, LOG + ".1")
    except OSError:
        pass


def notify(msg):
    env = dict(os.environ, DBUS_SESSION_BUS_ADDRESS="unix:path=/run/user/%d/bus" % os.getuid())
    try:
        subprocess.run(["notify-send", "-u", "critical", "at-guard", msg], env=env, timeout=3, check=False)
    except Exception:
        pass


def read(path):
    try:
        with open(path, "rb") as f:
            return f.read()
    except OSError:
        return b""


def snapshot():
    """pid -> dict(ppid, comm, cmd, cwd, rss_mb, ticks, state, start)"""
    procs = {}
    for d in glob.glob("/proc/[0-9]*"):
        pid = int(d[6:])
        stat = read(d + "/stat").decode("utf-8", "replace")
        if not stat:
            continue
        rp = stat.rfind(")")
        comm = stat[stat.find("(") + 1 : rp]
        f = stat[rp + 2 :].split()
        try:
            state, ppid = f[0], int(f[1])
            ticks = int(f[11]) + int(f[12])
            start = int(f[19])
            rss_mb = int(f[21]) * os.sysconf("SC_PAGE_SIZE") / 1048576
        except (IndexError, ValueError):
            continue
        cmd = read(d + "/cmdline").replace(b"\0", b" ").decode("utf-8", "replace").strip()
        try:
            cwd = os.readlink(d + "/cwd")
        except OSError:
            cwd = ""
        procs[pid] = dict(ppid=ppid, comm=comm, cmd=cmd, cwd=cwd, rss=rss_mb, ticks=ticks, state=state, start=start)
    return procs


def is_target(p):
    text = p["cmd"] + " " + p["comm"]
    if EXCLUDE_RE.search(text):
        return False
    if PATH_RE.search(p["cwd"]) or PATH_RE.search(p["cmd"]):
        return True
    return False


def children_map(procs):
    ch = {}
    for pid, p in procs.items():
        ch.setdefault(p["ppid"], []).append(pid)
    return ch


def tree(pid, ch):
    out, stack = [], [pid]
    while stack:
        x = stack.pop()
        out.append(x)
        stack.extend(ch.get(x, []))
    return out


def roots(procs, targets):
    """Top-most target of each target chain (so a whole run is judged as one tree)."""
    r = []
    for pid in targets:
        a = procs[pid]["ppid"]
        top = True
        while a in procs:
            if a in targets:
                top = False
                break
            a = procs[a]["ppid"]
        if top:
            r.append(pid)
    return r


def temp_c():
    best = 0.0
    for z in glob.glob("/sys/class/thermal/thermal_zone*/temp"):
        try:
            best = max(best, int(read(z)) / 1000.0)
        except ValueError:
            pass
    return best


def mem_avail_mb():
    for line in read("/proc/meminfo").decode().splitlines():
        if line.startswith("MemAvailable:"):
            return int(line.split()[1]) / 1024
    return 1e9


def kill_tree(pid, ch, procs, why):
    pids = tree(pid, ch)
    desc = procs[pid]["cmd"][:100] if pid in procs else str(pid)
    log("KILL %s tree=%d pids (%s): %s" % (pid, len(pids), why, desc))
    notify("killed runaway task: %s" % why)
    if DRY:
        return
    for sig in (signal.SIGTERM, signal.SIGKILL):
        for p in reversed(pids):
            try:
                os.kill(p, sig)
            except (ProcessLookupError, PermissionError):
                pass
        if sig == signal.SIGTERM:
            time.sleep(CONFIG["TERM_GRACE_S"])


def signal_all(pids, sig):
    if DRY:
        return
    for p in pids:
        try:
            os.kill(p, sig)
        except (ProcessLookupError, PermissionError):
            pass


def main():
    log("guard start dry=%s ncpu=%d cfg=%s" % (DRY, NCPU, CONFIG))
    hz = os.sysconf("SC_CLK_TCK")
    prev, prev_t = {}, time.time()
    over_tree = {}   # root pid -> first over time
    over_agg = None
    hot_since = None
    paused_since = None
    paused = []
    while True:
        time.sleep(CONFIG["INTERVAL_S"])
        now = time.time()
        dt = max(now - prev_t, 0.1)
        procs = snapshot()
        ch = children_map(procs)
        targets = {pid for pid, p in procs.items() if pid != SELF and is_target(p)}
        # a stopped run still holds ticks; cpu% from deltas
        cpu = {}
        for pid in targets:
            old = prev.get(pid)
            cpu[pid] = ((procs[pid]["ticks"] - old) / hz / dt * 100.0) if old is not None else 0.0
        prev = {pid: procs[pid]["ticks"] for pid in targets}
        prev_t = now
        rts = roots(procs, targets)
        stats = {}
        for r in rts:
            members = [x for x in tree(r, ch) if x in procs]
            stats[r] = (sum(cpu.get(x, 0.0) for x in members), sum(procs[x]["rss"] for x in members))
        t = temp_c()
        avail = mem_avail_mb()

        def heaviest():
            return max(stats, key=lambda r: stats[r][0] + stats[r][1] / 100.0) if stats else None

        # 0. fan-out breaker: runaway recursive delegation spawns many detached runs
        watchers = [pid for pid in targets if "run-watch.js" in procs[pid]["cmd"]]
        if len(watchers) > CONFIG["MAX_AT_RUNS"]:
            log("FANOUT %d at-runs > %d: killing all agent runs" % (len(watchers), CONFIG["MAX_AT_RUNS"]))
            notify("at fan-out (%d runs): killed all agent runs" % len(watchers))
            victims = set()
            for w in watchers:
                victims.update(tree(w, ch))
                agent_pid = int(procs[w]["cmd"].split("run-watch.js")[1].split()[0]) if procs[w]["cmd"].split("run-watch.js")[1].split() else 0
                if agent_pid in procs:
                    victims.update(tree(agent_pid, ch))
            if not DRY:
                for sig in (signal.SIGTERM, signal.SIGKILL):
                    for v in victims:
                        try:
                            os.kill(v, sig)
                        except (ProcessLookupError, PermissionError):
                            pass
                    if sig == signal.SIGTERM:
                        time.sleep(CONFIG["TERM_GRACE_S"])
            continue
        # 1. system memory floor
        if avail < CONFIG["MIN_AVAIL_MB"] and stats:
            h = heaviest()
            kill_tree(h, ch, procs, "system MemAvailable %dMB < %dMB" % (avail, CONFIG["MIN_AVAIL_MB"]))
            continue
        # 2. temperature
        if t >= CONFIG["KILL_C"]:
            hot_since = hot_since or now
            if now - hot_since >= CONFIG["TEMP_SUSTAIN_S"] and stats:
                for r in sorted(stats, key=lambda r: -stats[r][0]):
                    kill_tree(r, ch, procs, "temp %.0fC >= %.0fC" % (t, CONFIG["KILL_C"]))
                hot_since = None
                paused = []
                paused_since = None
                continue
        else:
            hot_since = None
        if t >= CONFIG["PAUSE_C"] and not paused and stats:
            paused = [x for r in stats for x in tree(r, ch) if x in procs]
            paused_since = now
            log("PAUSE %d procs at %.0fC" % (len(paused), t))
            notify("CPU %.0fC: paused agent-tier work until < %.0fC" % (t, CONFIG["RESUME_C"]))
            signal_all(paused, signal.SIGSTOP)
            continue
        if paused:
            if t <= CONFIG["RESUME_C"]:
                log("RESUME %d procs at %.0fC" % (len(paused), t))
                signal_all(paused, signal.SIGCONT)
                paused, paused_since = [], None
            elif now - paused_since > CONFIG["PAUSE_MAX_S"]:
                signal_all(paused, signal.SIGCONT)
                for r in list(stats):
                    kill_tree(r, ch, procs, "paused > %ds" % CONFIG["PAUSE_MAX_S"])
                paused, paused_since = [], None
            continue
        # 3. per-tree limits
        killed = False
        for r, (c, rss) in stats.items():
            if rss > CONFIG["PROC_RSS_MAX_MB"]:
                kill_tree(r, ch, procs, "tree RSS %dMB > %dMB" % (rss, CONFIG["PROC_RSS_MAX_MB"]))
                killed = True
                break
            if c > CONFIG["TREE_CPU_MAX_PCT"]:
                over_tree.setdefault(r, now)
                if now - over_tree[r] >= CONFIG["CPU_SUSTAIN_S"]:
                    kill_tree(r, ch, procs, "tree CPU %.0f%% > %.0f%% for %ds" % (c, CONFIG["TREE_CPU_MAX_PCT"], CONFIG["CPU_SUSTAIN_S"]))
                    over_tree.pop(r, None)
                    killed = True
                    break
            else:
                over_tree.pop(r, None)
        for r in list(over_tree):
            if r not in stats:
                over_tree.pop(r)
        if killed:
            continue
        # 4. aggregate
        tot_c = sum(v[0] for v in stats.values())
        tot_r = sum(v[1] for v in stats.values())
        if tot_r > CONFIG["AGG_RSS_MAX_MB"]:
            kill_tree(heaviest(), ch, procs, "aggregate RSS %dMB > %dMB" % (tot_r, CONFIG["AGG_RSS_MAX_MB"]))
            continue
        if tot_c > CONFIG["AGG_CPU_MAX_PCT"]:
            over_agg = over_agg or now
            if now - over_agg >= CONFIG["AGG_CPU_SUSTAIN_S"]:
                kill_tree(heaviest(), ch, procs, "aggregate CPU %.0f%% > %.0f%%" % (tot_c, CONFIG["AGG_CPU_MAX_PCT"]))
                over_agg = None
        else:
            over_agg = None
        if "--once" in sys.argv:
            log("once: targets=%d trees=%d cpu=%.0f%% rss=%dMB temp=%.0fC avail=%dMB" % (len(targets), len(stats), tot_c, tot_r, t, avail))
            return


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        pass
