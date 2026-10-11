// Package state resolves which `.at/` state directories the web server
// serves — mirroring `resolveStatusDirs` in src/state-dir.ts: the project
// `.at/` (when it holds state) first, then `~/.at/`. An explicit override
// (flag or AT_STATE_DIR env) collapses to a single directory.
package state

import (
	"os"
	"path/filepath"
)

const atDir = ".at"

// FindProjectRoot walks up from startDir to the nearest directory containing
// `.git/`. Returns "" when no git root is found.
func FindProjectRoot(startDir string) string {
	dir, err := filepath.Abs(startDir)
	if err != nil {
		return ""
	}
	for {
		if _, err := os.Stat(filepath.Join(dir, ".git")); err == nil {
			return dir
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			return ""
		}
		dir = parent
	}
}

func hasAtState(dir string) bool {
	for _, name := range []string{"state.json", "runs.jsonl"} {
		if _, err := os.Stat(filepath.Join(dir, name)); err == nil {
			return true
		}
	}
	return false
}

func homeAtDir() string {
	home, err := os.UserHomeDir()
	if err != nil {
		return filepath.Join(string(filepath.Separator), ".at")
	}
	return filepath.Join(home, atDir)
}

// ScopeOf classifies a state dir for the joined `scope` annotation:
// `~/.at/` is "global", everything else is "project".
func ScopeOf(dir string) string {
	if dir == homeAtDir() {
		return "global"
	}
	return "project"
}

// ResolveStatusDirs returns the state dirs to join, in precedence order.
// An explicit dir (or AT_STATE_DIR) collapses to a single entry; otherwise
// project-root `.at/` (when it holds state) and `~/.at/` are joined.
func ResolveStatusDirs(explicit string, cwd string) []string {
	if explicit != "" {
		return []string{explicit}
	}
	if env := os.Getenv("AT_STATE_DIR"); env != "" {
		return []string{env}
	}

	var dirs []string
	if projectRoot := FindProjectRoot(cwd); projectRoot != "" {
		projectAt := filepath.Join(projectRoot, atDir)
		if hasAtState(projectAt) {
			dirs = append(dirs, projectAt)
		}
	}
	home := homeAtDir()
	if !contains(dirs, home) {
		dirs = append(dirs, home)
	}
	return dirs
}

func contains(dirs []string, dir string) bool {
	for _, d := range dirs {
		if d == dir {
			return true
		}
	}
	return false
}
