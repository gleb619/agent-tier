#!/usr/bin/env bash
set -euo pipefail

SHORT_NAME="$1"
WORKTREE_PATH="../agent-tier-${SHORT_NAME}"
BRANCH_NAME="feat/${SHORT_NAME}"

if [ ! -d "$WORKTREE_PATH" ]; then
  git worktree add "$WORKTREE_PATH" -b "$BRANCH_NAME" main
fi

WORKTREE_ABS="$(cd "$WORKTREE_PATH" && pwd)"
MAIN_NODE_MODULES="$(pwd)/node_modules"
WORKTREE_NODE_MODULES="$WORKTREE_ABS/node_modules"

if [ ! -e "$WORKTREE_NODE_MODULES" ]; then
  ln -s "$MAIN_NODE_MODULES" "$WORKTREE_NODE_MODULES"
fi

# webui is its own pnpm workspace member with its own node_modules (vite etc.)
if [ -d "$(pwd)/src/webui/node_modules" ] && [ ! -e "$WORKTREE_ABS/src/webui/node_modules" ]; then
  ln -s "$(pwd)/src/webui/node_modules" "$WORKTREE_ABS/src/webui/node_modules"
fi

echo "$WORKTREE_ABS"
