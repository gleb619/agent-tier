#!/usr/bin/env bash
# at-safe: run a command (usually `at ...`, pnpm, vitest, go) with hard limits so one
# runaway task cannot freeze the laptop.
#   AT_SAFE_CPUS  (default 0-3)  CPU affinity: only these cores (8 cores => max 50% of machine)
#   AT_SAFE_TIME  (default 2400) wall-clock seconds, then SIGTERM (+10s SIGKILL)
#   AT_SAFE_TASKS (default 3000) max processes/threads (pids cgroup, works on cgroup v1)
# NOTE: this host uses cgroup v1, where an unprivileged user manager cannot set MemoryMax /
# CPUQuota. Memory is therefore enforced by scripts/resource-guard.py (systemd user service)
# and by the RSS watchdog inside `at` (AT_MAX_RSS_MB), not here.
# Usage: scripts/at-safe.sh at -s -t 1 -p "..."
set -u
CPUS=${AT_SAFE_CPUS:-0-3}; TIME=${AT_SAFE_TIME:-2400}; TASKS=${AT_SAFE_TASKS:-3000}
cmd=(nice -n 10 ionice -c3)
command -v taskset >/dev/null && cmd+=(taskset -c "$CPUS")
cmd+=(timeout -k 10 "$TIME" "$@")
if command -v systemd-run >/dev/null && systemctl --user is-system-running >/dev/null 2>&1; then
  exec systemd-run --user --scope --quiet --collect -p TasksMax="$TASKS" "${cmd[@]}"
fi
exec "${cmd[@]}"
