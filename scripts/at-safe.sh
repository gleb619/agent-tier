#!/usr/bin/env bash
# at-safe: run any command (usually `at ...`, pnpm, vitest, go) inside a transient systemd
# user scope with HARD kernel limits, so one runaway task cannot freeze the laptop.
#   AT_SAFE_MEM   (default 8G)   memory ceiling, no swap
#   AT_SAFE_CPU   (default 400%) CPU ceiling, 100% = one core (8 cores => 800%)
#   AT_SAFE_TASKS (default 3000) max processes/threads
#   AT_SAFE_TIME  (default 2400) wall-clock seconds, then SIGTERM (+10s SIGKILL)
# Usage: scripts/at-safe.sh at -s -t 1 -p "..."
set -u
MEM=${AT_SAFE_MEM:-8G}; CPU=${AT_SAFE_CPU:-400%}; TASKS=${AT_SAFE_TASKS:-3000}; TIME=${AT_SAFE_TIME:-2400}
if ! command -v systemd-run >/dev/null || ! systemctl --user is-system-running >/dev/null 2>&1; then
  echo "[at-safe] systemd user session unavailable; falling back to ulimit+timeout" >&2
  ulimit -v $((8*1024*1024)) 2>/dev/null || true
  exec timeout -k 10 "$TIME" nice -n 10 "$@"
fi
exec systemd-run --user --scope --quiet --collect \
  -p MemoryMax="$MEM" -p MemorySwapMax=0 -p CPUQuota="$CPU" -p TasksMax="$TASKS" \
  -p RuntimeMaxSec="$TIME" -p OOMPolicy=kill \
  nice -n 10 ionice -c3 "$@"
