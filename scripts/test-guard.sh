#!/usr/bin/env bash
# test-guard.sh — guards against accidental live-agent test runs and orphan spawns.
#
# Usage: scripts/test-guard.sh <command> [args]
#
# Commands:
#   check                  Fail (exit 1) if the default `npm test` path can reach
#                          tests_ai/** (package.json `test` script or vitest.config.ts
#                          include). Also fail if AT_LIVE_AGENTS=1 is set under CI
#                          (CI=true) unless AT_ALLOW_LIVE=1.
#   orphans [--kill]       List orphan `dist/cli.js ... -s -a ...` processes scoped to
#                          THIS repo root (never other worktrees). --kill: SIGTERM,
#                          then SIGKILL after 3s.
#   worktree-clean <path>  Kill this worktree's orphans, refuse (exit 1) if any
#                          survive, and print the `git worktree remove` command to run.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

fail() { echo "test-guard: FAIL: $*" >&2; exit 1; }

# Print "PID cmdline" lines for orphan processes whose cmdline contains
# "<root>/dist/cli.js" followed by " -s -a ". Never matches this script's own
# pid or processes from other roots.
scan_orphans() {
  local root="$1" pid cmd dir
  for dir in /proc/[0-9]*; do
    pid="${dir#/proc/}"
    [ "$pid" = "$$" ] && continue
    cmd="$(tr '\0' ' ' < "$dir/cmdline" 2>/dev/null)" || continue
    case "$cmd" in
      *"$root/dist/cli.js"*" -s -a "*) printf '%s %s\n' "$pid" "$cmd" ;;
    esac
  done
}

cmd_check() {
  local test_script cfg
  test_script="$(node -e 'console.log(require(process.argv[1]).scripts.test ?? "")' "$ROOT/package.json")"
  case "$test_script" in
    *tests_ai*) fail "package.json 'test' script references tests_ai — default test run must be unit-only (tests/**). Live agents go through 'npm run test:agents'." ;;
  esac

  cfg="$ROOT/vitest.config.ts"
  if [ ! -f "$cfg" ]; then fail "vitest.config.ts not found at $cfg"; fi
  if grep -v '^\s*//' "$cfg" | grep -q "tests_ai"; then
    fail "vitest.config.ts default include references tests_ai — live-agent suite must only be collected by vitest.live.config.ts (npm run test:agents)."
  fi

  if [ "${AT_LIVE_AGENTS:-}" = "1" ] && [ "${CI:-}" = "true" ] && [ "${AT_ALLOW_LIVE:-}" != "1" ]; then
    fail "AT_LIVE_AGENTS=1 under CI (CI=true) is not allowed (would burn real agent quota). Set AT_ALLOW_LIVE=1 to override deliberately."
  fi

  echo "OK: default test path is unit-only; no live-agent leak"
}

cmd_orphans() {
  local kill=0
  [ "${1:-}" = "--kill" ] && kill=1
  local found
  found="$(scan_orphans "$ROOT")"
  if [ -z "$found" ]; then
    echo "OK: no orphan processes for $ROOT"
    return 0
  fi
  echo "$found"
  if [ "$kill" -eq 1 ]; then
    local pids
    pids="$(echo "$found" | awk '{print $1}')"
    kill -TERM $pids 2>/dev/null || true
    local waited=0
    while [ $waited -lt 30 ]; do
      kill -0 $pids 2>/dev/null || break
      sleep 0.1
      waited=$((waited + 1))
    done
    kill -KILL $pids 2>/dev/null || true
    echo "Killed orphans: $pids"
  fi
}

cmd_worktree_clean() {
  local wt="${1:-}"
  [ -z "$wt" ] && fail "usage: test-guard.sh worktree-clean <worktree-path>"
  wt="$(cd "$wt" && pwd)"
  local found pids
  found="$(scan_orphans "$wt")"
  if [ -n "$found" ]; then
    echo "$found"
    pids="$(echo "$found" | awk '{print $1}')"
    kill -TERM $pids 2>/dev/null || true
    local waited=0
    while [ $waited -lt 30 ]; do
      kill -0 $pids 2>/dev/null || break
      sleep 0.1
      waited=$((waited + 1))
    done
    kill -KILL $pids 2>/dev/null || true
    sleep 0.2
    found="$(scan_orphans "$wt")"
  fi
  if [ -n "$found" ]; then
    echo "$found"
    fail "orphan processes still alive in $wt — kill them before removing the worktree"
  fi
  echo "OK: no orphans in $wt"
  echo "next: git worktree remove $wt"
}

case "${1:-}" in
  check) cmd_check ;;
  orphans) shift; cmd_orphans "$@" ;;
  worktree-clean) shift; cmd_worktree_clean "$@" ;;
  -h|--help|"") sed -n '2,14p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//' ;;
  *) echo "unknown command: $1" >&2; exit 2 ;;
esac
