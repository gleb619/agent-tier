#!/usr/bin/env bash
# Safe sequential merge: rebase worktree branch onto main, ff-merge from the main checkout,
# and only then clean up. Any failure is loud and leaves the worktree intact.
set -euo pipefail

if [[ $# -ne 2 ]]; then
  echo "USAGE: $0 <worktree-path> <branch>"
  exit 1
fi

WORKTREE="$(cd "$1" && pwd)"
BRANCH="$2"

cd "$WORKTREE"
if [[ -n "$(git status --porcelain)" ]]; then
  echo "DIRTY_WORKTREE"
  exit 1
fi

if ! git rebase main; then
  echo "REBASE_CONFLICT"
  exit 1
fi

# The main checkout is the parent of the shared git dir (not --show-toplevel, which is the worktree).
COMMON_DIR="$(cd "$(git rev-parse --git-common-dir)" && pwd)"
MAIN_ROOT="$(dirname "$COMMON_DIR")"
if ! git -C "$MAIN_ROOT" merge --ff-only "$BRANCH"; then
  echo "MERGE_FAIL"
  exit 1
fi

cd "$MAIN_ROOT"
git worktree remove "$WORKTREE"
git branch -d "$BRANCH"
git worktree prune

echo "MERGED"
