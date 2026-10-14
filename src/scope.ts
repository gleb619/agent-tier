/**
 * Scope enforcement for --scope <glob> flag.
 *
 * Tiny glob matcher (no new dependencies): supports `**`, `*`, `?`.
 *   `**`  — matches zero or more path segments (including slashes)
 *   `*`   — matches any sequence of non-slash characters
 *   `?`   — matches exactly one non-slash character
 *
 * All paths are normalised to forward-slash before matching.
 */

/**
 * Convert a glob pattern to a RegExp.
 * Leading `./` is stripped from both pattern and path before comparison.
 */
export function globToRegExp(pattern: string): RegExp {
  // Normalise separators and strip leading ./
  const p = pattern.replace(/\\/g, "/").replace(/^\.\//, "");

  let re = "";
  let i = 0;
  while (i < p.length) {
    const ch = p[i];
    if (ch === "*" && p[i + 1] === "*") {
      if (p[i + 2] === "/") {
        // `**/` — matches zero or more path segments (including their trailing slash)
        re += "(?:.+/)?";
        i += 3;
      } else {
        // `**` at end — matches everything (including slashes)
        re += ".*";
        i += 2;
      }
      continue;
    }
    if (ch === "*") {
      // single `*` — matches any sequence of non-slash characters
      re += "[^/]*";
    } else if (ch === "?") {
      // `?` — matches exactly one non-slash character
      re += "[^/]";
    } else if (/[.+^${}()|[\]\\]/.test(ch)) {
      re += `\\${ch}`;
    } else {
      re += ch;
    }
    i++;
  }

  return new RegExp(`^${re}$`);
}

/**
 * Returns true when `filePath` matches any of the given glob patterns.
 * Paths are normalised to forward-slash and leading `./` stripped.
 */
export function matchesScope(filePath: string, patterns: string[]): boolean {
  if (patterns.length === 0) return true;
  const normalised = filePath.replace(/\\/g, "/").replace(/^\.\//, "");
  return patterns.some((pat) => globToRegExp(pat).test(normalised));
}

/**
 * Build the prompt suffix that instructs the agent to stay inside the given
 * scope globs and never run repo-wide formatters.
 */
export function buildScopeSuffix(globs: string[]): string {
  if (globs.length === 0) return "";
  const list = globs.map((g) => `  - ${g}`).join("\n");
  return (
    "\n\n---\n" +
    "SCOPE RESTRICTION (enforced by the task runner):\n" +
    "Modify ONLY files matching these globs (plus any new test files you create):\n" +
    `${list}\n` +
    "Do NOT run repo-wide formatters (e.g. biome --write ., prettier --write ., " +
    "eslint --fix .) or edit files outside the listed globs."
  );
}

/**
 * Given a list of changed file paths (from `git status --porcelain` or
 * `git diff --name-only HEAD`) and the scope globs, return the paths that
 * are outside the scope.
 *
 * An empty `globs` array means no scope restriction — always returns [].
 */
export function findScopeViolations(changedPaths: string[], globs: string[]): string[] {
  if (globs.length === 0) return [];
  return changedPaths.filter((p) => !matchesScope(p, globs));
}
