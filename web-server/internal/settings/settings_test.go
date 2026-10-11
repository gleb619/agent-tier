package settings

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestLoadMissingFileIsEmpty(t *testing.T) {
	got := Load(filepath.Join(t.TempDir(), "web-settings.json"))
	if len(got) != 0 {
		t.Fatalf("Load missing = %v, want empty", got)
	}
}

func TestLoadNonObjectIsEmpty(t *testing.T) {
	dir := t.TempDir()
	file := filepath.Join(dir, "web-settings.json")
	for _, content := range []string{"[1,2]", `"nope"`, "{broken"} {
		if err := os.WriteFile(file, []byte(content), 0o644); err != nil {
			t.Fatal(err)
		}
		if got := Load(file); len(got) != 0 {
			t.Fatalf("Load(%s) = %v, want empty", content, got)
		}
	}
}

func TestSaveLoadRoundtrip(t *testing.T) {
	file := filepath.Join(t.TempDir(), "web-settings.json")
	obj := map[string]any{"defaultTier": float64(2), "retries": float64(3)}
	if err := Save(file, obj); err != nil {
		t.Fatal(err)
	}
	raw, err := os.ReadFile(file)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.HasSuffix(string(raw), "}\n") || !strings.Contains(string(raw), "\n  \"defaultTier\"") {
		t.Fatalf("file not 2-space indented with trailing newline: %q", string(raw))
	}
	got := Load(file)
	if got["defaultTier"] != float64(2) || got["retries"] != float64(3) {
		t.Fatalf("roundtrip = %v", got)
	}
}

func TestSaveCreatesParentDirs(t *testing.T) {
	file := filepath.Join(t.TempDir(), "nested", "dirs", "web-settings.json")
	if err := Save(file, map[string]any{}); err != nil {
		t.Fatalf("Save nested = %v", err)
	}
	if _, err := os.Stat(file); err != nil {
		t.Fatal(err)
	}
}
