package state

import (
	"os"
	"path/filepath"
	"testing"
)

func TestFindProjectRoot(t *testing.T) {
	root := t.TempDir()
	if err := os.MkdirAll(filepath.Join(root, ".git"), 0o755); err != nil {
		t.Fatal(err)
	}
	nested := filepath.Join(root, "a", "b")
	if err := os.MkdirAll(nested, 0o755); err != nil {
		t.Fatal(err)
	}
	if got := FindProjectRoot(nested); got != root {
		t.Fatalf("FindProjectRoot = %q, want %q", got, root)
	}
	if got := FindProjectRoot(filepath.Join(root, "a")); got != root {
		t.Fatalf("FindProjectRoot(a) = %q, want %q", got, root)
	}
}

func TestFindProjectRootNone(t *testing.T) {
	// A fresh temp dir has no .git anywhere up the tree (assuming TMPDIR does not either).
	deep := filepath.Join(t.TempDir(), "x", "y")
	if err := os.MkdirAll(deep, 0o755); err != nil {
		t.Fatal(err)
	}
	if got := FindProjectRoot(deep); got != "" {
		t.Fatalf("FindProjectRoot = %q, want empty", got)
	}
}

func hasAtStateContains(t *testing.T, dirs []string, want string) {
	t.Helper()
	found := false
	for _, d := range dirs {
		if d == want {
			found = true
		}
	}
	if !found {
		t.Fatalf("ResolveStatusDirs = %v, want to contain %q", dirs, want)
	}
}

func TestResolveStatusDirsExplicitWins(t *testing.T) {
	got := ResolveStatusDirs("/some/dir", t.TempDir())
	if len(got) != 1 || got[0] != "/some/dir" {
		t.Fatalf("ResolveStatusDirs(explicit) = %v, want [/some/dir]", got)
	}
}

func TestResolveStatusDirsStateDirEnvCollapses(t *testing.T) {
	t.Setenv("AT_STATE_DIR", "/env/dir")
	got := ResolveStatusDirs("", t.TempDir())
	if len(got) != 1 || got[0] != "/env/dir" {
		t.Fatalf("ResolveStatusDirs(env) = %v, want [/env/dir]", got)
	}
}

func TestResolveStatusDirsProjectPlusHome(t *testing.T) {
	// Clear leaked AT_STATE_DIR from environment
	t.Setenv("AT_STATE_DIR", "")
	home := t.TempDir()
	t.Setenv("HOME", home)
	cwd := t.TempDir()
	if err := os.MkdirAll(filepath.Join(cwd, ".git"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Join(cwd, ".at"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(cwd, ".at", "runs.jsonl"), nil, 0o644); err != nil {
		t.Fatal(err)
	}
	got := ResolveStatusDirs("", cwd)
	if len(got) != 2 {
		t.Fatalf("ResolveStatusDirs = %v, want 2 dirs", got)
	}
	if got[0] != filepath.Join(cwd, ".at") {
		t.Fatalf("first dir = %q, want project .at", got[0])
	}
	hasAtStateContains(t, got, filepath.Join(home, ".at"))
}

func TestResolveStatusDirsEmptyProjectSkipped(t *testing.T) {
	home := t.TempDir()
	t.Setenv("HOME", home)
	t.Setenv("AT_STATE_DIR", "")
	cwd := t.TempDir()
	if err := os.MkdirAll(filepath.Join(cwd, ".git"), 0o755); err != nil {
		t.Fatal(err)
	}
	// .at exists but has no state.json/runs.jsonl → not joined.
	if err := os.MkdirAll(filepath.Join(cwd, ".at"), 0o755); err != nil {
		t.Fatal(err)
	}
	got := ResolveStatusDirs("", cwd)
	if len(got) != 1 || got[0] != filepath.Join(home, ".at") {
		t.Fatalf("ResolveStatusDirs = %v, want [home/.at]", got)
	}
}

func TestScopeOf(t *testing.T) {
	home := t.TempDir()
	t.Setenv("HOME", home)
	if got := ScopeOf(filepath.Join(home, ".at")); got != "global" {
		t.Fatalf("ScopeOf(home) = %q, want global", got)
	}
	if got := ScopeOf(t.TempDir()); got != "project" {
		t.Fatalf("ScopeOf(other) = %q, want project", got)
	}
}
