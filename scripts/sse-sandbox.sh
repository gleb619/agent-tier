#!/usr/bin/env bash
# E2E sandbox for SSE + discuss channel.
# Usage: scripts/sse-sandbox.sh <agent|all> [timeoutSec=240]
set -u
set -o pipefail

CLI="node /media/boris/data_nvme1n1/WORKSPACES/WORKSPACE/agent-tier/dist/cli.js"
TARGET="${1:-}"
TIMEOUT="${2:-240}"
AGENTS="mm-code glm-code codex kimi qwen opencode pi kilo cline kiro cursor agy"

if [[ -z "$TARGET" ]]; then
  echo "usage: $0 <agent|all> [timeoutSec]" >&2
  exit 2
fi

# Tiny CSV row appender (no printf quoting issues)
RESULTS_DIR="$(mktemp -d -t sse-results-XXXXXX)"
SUMMARY="$RESULTS_DIR/summary.tsv"
printf 'agent\tstatus\thello\tcolor\tasked\tanswered\tmsgs\ttools\tsecs\n' > "$SUMMARY"

# Resolve registry bin path via node (so we mirror registry resolution incl. env).
bin_for() {
  node -e '
    const r = require("/media/boris/data_nvme1n1/WORKSPACES/WORKSPACE/agent-tier/dist/agents/registry.js");
    const a = r.getAgentByName(process.argv[1]);
    if (!a) process.exit(2);
    process.stdout.write(a.bin());
  ' "$1" 2>/dev/null
}

run_one() {
  local agent="$1"
  local SB S t0 t1 status hello_ok color_ok asked answered msg_n tool_n secs bin_path
  SB="$(mktemp -d -t sse-sb-XXXXXX)"
  S="$SB/state"
  mkdir -p "$S"
  bin_path="$(bin_for "$agent")"

  if [[ -z "$bin_path" || ! -x "$bin_path" && ! -e "$bin_path" ]]; then
    printf '%s\tSKIP\t-\t-\t-\t-\t-\t-\t-\n' "$agent" >> "$SUMMARY"
    rm -rf "$SB"; return 0
  fi

  local prompt='In the current directory: 1) create hello.txt containing exactly: hello from '"$agent"'. 2) You need a decision from the host: ask which color to use, with options red and blue, via the host channel instruction appended to this prompt. 3) Write the chosen answer (just the word) into color.txt. 4) Then post a note '"'"'finished'"'"' and stop.'

  t0=$SECONDS
  ( cd "$SB" && exec $CLI -s -a "$agent" --sse 0 --state-dir "$S" -p "$prompt" ) \
    > "$S/run.log" 2>&1 &
  local cli_pid=$!

  # Wait up to 20s for runId + pid lines to appear
  local runId agent_pid
  for _ in $(seq 1 40); do
    sleep 0.5
    runId="$(grep -oE 'runId: [a-z0-9-]+' "$S/run.log" 2>/dev/null | head -1 | awk '{print $2}')"
    agent_pid="$(grep -oE 'pid [0-9]+' "$S/run.log" 2>/dev/null | head -1 | awk '{print $2}')"
    [[ -n "$runId" && -n "$agent_pid" ]] && break
  done

  if [[ -z "$runId" ]]; then
    wait "$cli_pid" 2>/dev/null
    if grep -qE 'ENOENT|not found' "$S/run.log"; then
      printf '%s\tSKIP\t-\t-\t-\t-\t-\t-\t-\n' "$agent" >> "$SUMMARY"
    elif [[ "$agent" == "mock" || "$agent" == "mock-long" ]]; then
      printf '%s\tSKIP-QUESTION\t-\t-\t-\t-\t-\t-\t-\n' "$agent" >> "$SUMMARY"
    else
      printf '%s\tFAIL\t-\t-\t-\t-\t-\t-\t-\n' "$agent" >> "$SUMMARY"
    fi
    rm -rf "$SB"; return 0
  fi

  export AT_RUN_ID="$runId" AT_STATE_DIR="$S"

  # Auto-responder: poll --pending, answer first question with "blue"
  local deadline=$((SECONDS + TIMEOUT)) answered_id=""
  while (( SECONDS < deadline )); do
    if (( SECONDS > deadline - TIMEOUT + 5 )); then break; fi
    local pending
    pending="$($CLI discuss list "$runId" --pending --json --state-dir "$S" 2>/dev/null || true)"
    if [[ "$pending" == *'"kind":"question"'* ]]; then
      $CLI discuss answer blue -r "$runId" --state-dir "$S" >/dev/null 2>&1 && answered_id="y" || true
    fi
    sleep 1
  done

  # Wait for CLI to finish (best-effort, with bounded wait)
  local wait_left=$(( deadline - SECONDS ))
  (( wait_left < 0 )) && wait_left=5
  ( sleep "$wait_left"; kill -0 "$cli_pid" 2>/dev/null && kill "$cli_pid" 2>/dev/null ) &
  local watchdog=$!
  wait "$cli_pid" 2>/dev/null
  kill "$watchdog" 2>/dev/null

  # Kill any straggler child by stored PID
  [[ -n "$agent_pid" ]] && kill "$agent_pid" 2>/dev/null
  wait "$agent_pid" 2>/dev/null

  t1=$SECONDS; secs=$((t1 - t0))

  # Assertions
  hello_ok="n"; color_ok="n"; asked="n"; answered="n"
  if [[ -f "$SB/hello.txt" ]] && grep -qF "hello from $agent" "$SB/hello.txt"; then
    hello_ok="y"
  fi
  local color_val=""
  color_val="$(tr -d '[:space:]' < "$SB/color.txt" 2>/dev/null | tr '[:upper:]' '[:lower:]')"
  [[ "$color_val" == "blue" ]] && color_ok="y"

  local thread
  thread="$($CLI discuss list "$runId" --json --state-dir "$S" 2>/dev/null || true)"
  [[ "$thread" == *'"from":"agent"'*'"kind":"question"'* ]] && asked="y"
  [[ "$thread" == *'"from":"host"'*'"kind":"answer"'*blue* ]] && answered="y"

  local evf="$S/events/$runId.jsonl"
  msg_n="$(grep -c '"type":"message"' "$evf" 2>/dev/null || echo 0)"
  tool_n="$(grep -c '"type":"tool"' "$evf" 2>/dev/null || echo 0)"
  local start_done="n"
  grep -q '"type":"start"' "$evf" 2>/dev/null && grep -q '"type":"done"' "$evf" 2>/dev/null && start_done="y"

  if [[ "$hello_ok" == "y" && "$color_ok" == "y" && "$asked" == "y" \
     && "$answered" == "y" && "$start_done" == "y" ]]; then
    status="PASS"
  elif [[ "$agent" == "mock" || "$agent" == "mock-long" ]]; then
    status="SKIP-QUESTION"
  else
    status="FAIL"
  fi

  printf '%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\n' \
    "$agent" "$status" "$hello_ok" "$color_ok" "$asked" "$answered" \
    "$msg_n" "$tool_n" "$secs" >> "$SUMMARY"

  rm -rf "$SB"
}

if [[ "$TARGET" == "all" ]]; then
  for a in $AGENTS; do run_one "$a"; done
else
  run_one "$TARGET"
fi

echo
echo "agent            status         hello color asked answered msgs tools secs"
echo "---------------- -------------- ----- ----- ----- -------- ---- ----- ----"
while IFS=$'\t' read -r agent status hello_ok color_ok asked answered msg_n tool_n secs; do
  [[ "$agent" == "agent" ]] && continue
  printf '%-16s %-14s %-5s %-5s %-5s %-8s %-4s %-5s %s\n' \
    "$agent" "$status" "$hello_ok" "$color_ok" "$asked" "$answered" "$msg_n" "$tool_n" "$secs"
done < "$SUMMARY"

fail_count="$(awk -F'\t' 'NR>1 && $2=="FAIL"' "$SUMMARY" | wc -l)"
rm -rf "$RESULTS_DIR"
exit "$fail_count"