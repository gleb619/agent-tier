#!/usr/bin/env bash
# at_tests/run.sh — Integration tests for real agent binaries
#
# Usage:
#   npm run test:agents              # test all agents
#   npm run test:agents -- glm-code  # test one agent
#   npm run test:agents -- glm-code codex kimi  # test specific agents
#   npm run test:agents -- --timeout 300000     # custom timeout (ms)
#
# Each test creates a temp sandbox, runs the agent on a basic task,
# and checks exit code. Agents whose binaries aren't installed are skipped.
#
# This must be run locally — never in CI.

set -euo pipefail

cd "$(dirname "$0")/.."

# Build first if needed
if [[ ! -f dist/cli.js ]]; then
  echo "[at-tests] Building project..."
  npm run build --silent
fi

source at_tests/lib.sh

# ── Parse args ──
AGENTS_TO_TEST=()
EXTRA_ARGS=()

while [[ $# -gt 0 ]]; do
  case "$1" in
    --timeout)
      DEFAULT_TIMEOUT="$2"
      shift 2
      ;;
    -h|--help)
      echo "Usage: $0 [agent ...] [--timeout MS]"
      echo ""
      echo "Agents: glm-code codex kimi blackbox opencode qwen kilo gemini goose aider pi mock"
      echo "If no agents specified, tests all agents."
      exit 0
      ;;
    *)
      AGENTS_TO_TEST+=("$1")
      shift
      ;;
  esac
done

# Default: test all known agents
ALL_AGENTS=(glm-code codex kimi blackbox opencode qwen kilo gemini goose aider pi)
if [[ ${#AGENTS_TO_TEST[@]} -eq 0 ]]; then
  AGENTS_TO_TEST=("${ALL_AGENTS[@]}")
fi

echo "[at-tests] Agent integration tests"
echo "[at-tests] Timeout: ${DEFAULT_TIMEOUT}ms per agent"
echo ""

for agent in "${AGENTS_TO_TEST[@]}"; do
  run_agent_test "$agent" "Create a file called test_result.txt containing the text 'hello world' and nothing else."
done

print_summary
