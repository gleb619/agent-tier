#!/usr/bin/env bash
# ci-check.sh — local dry-run of .github/workflows/ci.yml
#
# Check 1 (dry run): validate the workflow file with wrkflw.
# Check 2 (docker):  install deps and build the project inside a node
#                    container, mirroring what the CI `build` job does.
# Check 3 (guard):   test-guard check — default test path must be unit-only
#                    (never collects tests_ai/**); no AT_LIVE_AGENTS=1 under CI.
#
# Usage: scripts/ci-check.sh [--skip-validate] [--skip-docker] [--skip-guard]
#
# Env overrides:
#   CI_WORKFLOW      path to the workflow file (default .github/workflows/ci.yml)
#   CI_DOCKER_IMAGE  image used for the build check (default node:22-bookworm-slim)
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORKFLOW="${CI_WORKFLOW:-$ROOT/.github/workflows/ci.yml}"
IMAGE="${CI_DOCKER_IMAGE:-node:22-bookworm-slim}"
SKIP_VALIDATE=0
SKIP_DOCKER=0
SKIP_GUARD=0

usage() {
  sed -n '2,13p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
}

for arg in "$@"; do
  case "$arg" in
    --skip-validate) SKIP_VALIDATE=1 ;;
    --skip-docker)   SKIP_DOCKER=1 ;;
    --skip-guard)    SKIP_GUARD=1 ;;
    -h|--help)       usage; exit 0 ;;
    *) echo "unknown option: $arg" >&2; usage >&2; exit 2 ;;
  esac
done

fail=0

if [ "$SKIP_VALIDATE" -eq 0 ]; then
  echo "==> [1/3] dry-run validate $WORKFLOW (wrkflw)"
  if ! command -v wrkflw >/dev/null 2>&1; then
    echo "ERROR: wrkflw not found in PATH — install it to validate CI workflows locally" >&2
    fail=1
  elif [ ! -f "$WORKFLOW" ]; then
    echo "ERROR: workflow file not found: $WORKFLOW" >&2
    fail=1
  elif wrkflw validate "$WORKFLOW"; then
    echo "OK: workflow valid"
  else
    echo "FAIL: workflow validation failed" >&2
    fail=1
  fi
fi

if [ "$SKIP_DOCKER" -eq 0 ]; then
  echo "==> [2/3] docker build check ($IMAGE)"
  if ! docker info >/dev/null 2>&1; then
    echo "ERROR: docker daemon not reachable" >&2
    fail=1
  elif docker run --rm \
      --user "$(id -u):$(id -g)" \
      -e HOME=/tmp \
      -v "$ROOT":/src:ro \
      -e npm_config_update_notifier=false \
      -e COREPACK_ENABLE_DOWNLOAD_PROMPT=0 \
      "$IMAGE" \
      sh -c 'work=/tmp/ci-check-build &&
        mkdir -p "$work" &&
        # Copy the tree instead of building in the bind mount: worktrees keep
        # node_modules as a symlink pointing outside the mount, and pnpm then
        # dies on ENOTDIR trying to mkdir /work/node_modules.
        tar -C /src --exclude=node_modules --exclude=.git -cf - . | tar -C "$work" -xf - &&
        cd "$work" &&
        corepack pnpm@9.15.9 install --frozen-lockfile --config.confirmModulesPurge=false &&
        corepack pnpm@9.15.9 run build &&
        node dist/cli.js --help >/dev/null'; then
    echo "OK: project builds in docker"
  else
    echo "FAIL: docker build check failed" >&2
    fail=1
  fi
fi

if [ "$SKIP_GUARD" -eq 0 ]; then
  echo "==> [3/3] test-guard check (unit-only default test path)"
  if bash "$ROOT/scripts/test-guard.sh" check; then
    echo "OK: test guard passed"
  else
    echo "FAIL: test guard failed" >&2
    fail=1
  fi
fi

exit "$fail"
