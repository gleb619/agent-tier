---
inclusion: always
---

# Workflow

All implementation work happens in an isolated worktree + branch. No edits on `main` directly.

## Worktree lifecycle

```bash
# Create
git worktree add ../agent-tier-<short-name> -b feat/<short-name> main
cd ../agent-tier-<short-name>
# or shortcut:
bash scripts/worktree-new.sh <short-name>

# Merge (rebase + ff-merge + cleanup)
bash scripts/merge-worktree.sh <worktree-path> <branch>

# Cleanup
bash scripts/test-guard.sh worktree-clean ../agent-tier-<short-name>
git branch -d feat/<short-name>
git worktree prune
```

## Guardrails — ALL must pass before merging

```bash
pnpm exec biome ci .      # lint + format
npx tsc --noEmit          # type-check
npx vitest run            # unit suite (tests/**) ONLY
```

CI guardrail — run additionally when any of these changed:
- `.github/workflows/*`
- `scripts/ci-check.sh`
- `package.json` `ci:check` script

```bash
pnpm run ci:check         # workflow dry-run validate + docker build check + test-guard
```

## Branch rules

- Always branch off `main`. Do not stack branches.
- If guardrails fail, fix in the same branch — do not rebase/rewrite history unless asked.
- If `git merge --ff-only` refuses (main moved on): `git rebase main` inside worktree, re-run guardrails, re-attempt ff merge.
- Working tree at end of session: clean on `main`, no stale worktrees, no stale local branches.

## Post-merge

- After touching `src/cli.ts`: rebuild `bin/at`:
  ```bash
  bun build --compile src/cli.ts --outfile bin/at
  ```
  (`bin/at` is gitignored; `~/.local/bin/at` wrapper goes stale otherwise)

## Hard rules

- **Never** `git stash` / `git reset` (or `--hard` / `--mixed` / `--soft`) without explicit user approval.
- **Never** add `Co-Authored-By` or similar AI-attribution trailers to commits.
- Preserve all working-tree state — do not discard.
