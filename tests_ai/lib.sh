#!/usr/bin/env bash
# Shared helpers for agent integration tests

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

PASS=0
FAIL=0
SKIP=0

# Default timeout per agent (ms)
DEFAULT_TIMEOUT=120000

# Create a fresh sandbox directory, return its path via global SANDBOX
create_sandbox() {
  SANDBOX=$(mktemp -d "/tmp/at-test-XXXXXX")
  # Initialize a git repo — some agents expect it
  git init -q "$SANDBOX"
  # Create a minimal file to work with
  echo "// placeholder" > "$SANDBOX/main.js"
  echo "node_modules/" > "$SANDBOX/.gitignore"
  git -C "$SANDBOX" add -A
  git -C "$SANDBOX" commit -q -m "init" --author="Test <test@test.com>"
}

# Remove sandbox
cleanup_sandbox() {
  if [[ -n "${SANDBOX:-}" && -d "$SANDBOX" ]]; then
    rm -rf "$SANDBOX"
  fi
}

# Check if an agent binary is available on this machine
# Uses the same env-var overrides as the registry
agent_bin_exists() {
  local agent="$1"
  local bin_path=""

  local node_bin="${NODE_BIN:-$HOME/.nvm/versions/node/v22.20.0/bin}"
  local local_bin="${LOCAL_BIN:-$HOME/.local/bin}"

  case "$agent" in
    glm-code)  bin_path="${GLM_CODE_BIN:-$local_bin/glm-code}" ;;
    codex)     bin_path="${CODEX_BIN:-$node_bin/codex}" ;;
    kimi)      bin_path="${KIMI_BIN:-$node_bin/kimi}" ;;
    blackbox)  bin_path="${BLACKBOX_BIN:-$local_bin/blackbox}" ;;
    opencode)  bin_path="${OPENCODE_BIN:-$node_bin/opencode}" ;;
    qwen)      bin_path="${QWEN_BIN:-$node_bin/qwen}" ;;
    mock)      bin_path="${MOCK_BIN:-$local_bin/mock-agent}" ;;
    kilo)      bin_path="${KILO_BIN:-$node_bin/kilo}" ;;
    gemini)    bin_path="${GEMINI_BIN:-$node_bin/gemini}" ;;
    goose)     bin_path="${GOOSE_BIN:-$local_bin/goose}" ;;
    aider)     bin_path="${AIDER_BIN:-$local_bin/aider}" ;;
    pi)        bin_path="${PI_BIN:-$node_bin/pi}" ;;
    *)         return 1 ;;
  esac

  [[ -x "$bin_path" ]]
}

# Run a single agent test
# Args: agent_name prompt [extra_at_args...]
run_agent_test() {
  local agent="$1"
  local prompt="$2"
  shift 2

  if ! agent_bin_exists "$agent"; then
    echo -e "  ${YELLOW}SKIP${NC} $agent — binary not found"
    ((SKIP++)) || true
    return 0
  fi

  create_sandbox
  # shellcheck disable=SC2068
  local at_args=(-s -a "$agent" -p "$prompt" --timeout "$DEFAULT_TIMEOUT" --no-chop "$@")

  echo -ne "  ${CYAN}RUN${NC}  $agent ... "

  local exit_code=0
  node dist/cli.js "${at_args[@]}" > "$SANDBOX/test-stdout.log" 2> "$SANDBOX/test-stderr.log" || exit_code=$?

  if [[ $exit_code -eq 0 ]]; then
    echo -e "${GREEN}PASS${NC} (exit 0)"
    ((PASS++)) || true
  else
    echo -e "${RED}FAIL${NC} (exit $exit_code)"
    echo "       stderr: $(tail -1 "$SANDBOX/test-stderr.log" 2>/dev/null)"
    ((FAIL++)) || true
  fi

  cleanup_sandbox
  return 0
}

# Print final summary
print_summary() {
  echo ""
  echo "─────────────────────────────────"
  local total=$((PASS + FAIL + SKIP))
  echo -e "  ${GREEN}$PASS passed${NC}  ${RED}$FAIL failed${NC}  ${YELLOW}$SKIP skipped${NC}  ($total total)"
  echo "─────────────────────────────────"
  [[ $FAIL -eq 0 ]]
}
