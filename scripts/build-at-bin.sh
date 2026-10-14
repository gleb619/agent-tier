#!/usr/bin/env bash
# build-at-bin.sh — build a standalone `bin/at` binary via `bun build --compile`
# and smoke-test it (tests/at-bin.test.ts).
#
# Usage: scripts/build-at-bin.sh [--skip-smoke]
#
# Output: bin/at (gitignored, produced on demand — NOT committed).
# Exclusions (by design): the WebUI assets and the Go at-web backend are NOT
# embedded — `at web` still needs web-server/ + src/webui/dist on disk. The TUI
# entry (src/tui) is also not bundled; `bin/at` is a non-interactive tool.
#
# Known compiled-binary fallbacks (all degrade gracefully, no crash):
#   - dynamic require() of generic plugins (src/agents/generic-loader.ts):
#     plugin load errors are caught and reported as agent failures
#   - detached-run supervisor (run-watch.js) and log-streamer.js: missing
#     files fall back to plain tail / best-effort spawn
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

command -v bun >/dev/null 2>&1 || { echo "build-at-bin: bun not found on PATH (https://bun.sh)" >&2; exit 1; }

VERSION="$(node -e 'console.log(require("./package.json").version)')"
OUT="bin/at"

mkdir -p bin
bun build --compile --target bun-linux-x64 \
  --define "process.env.AT_VERSION=\"${VERSION}\"" \
  src/cli.ts --outfile "$OUT"

echo "build-at-bin: built $OUT ($(du -h "$OUT" | cut -f1))"

if [ "${1:-}" = "--skip-smoke" ]; then
  exit 0
fi

npx vitest run tests/at-bin.test.ts
