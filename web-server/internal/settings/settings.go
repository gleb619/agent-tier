// Package settings loads and persists `<stateDir>/web-settings.json` — the
// WebUI defaults store served by GET/PUT /api/settings. Writes are atomic
// (temp file + rename) and formatted like the Node server: 2-space indent,
// trailing newline.
package settings

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
)

const fileName = "web-settings.json"

// File returns the settings path for the joined state dirs: the first dir
// wins; when the list is empty, `<cwd>/.at/` is used (matches the Node
// settingsFile()).
func File(stateDirs []string, cwd string) string {
	if len(stateDirs) > 0 {
		return filepath.Join(stateDirs[0], fileName)
	}
	return filepath.Join(cwd, ".at", fileName)
}

// Load parses the settings file. Missing, malformed or non-object content
// yields an empty object — settings are best-effort defaults, never fatal.
func Load(file string) map[string]any {
	raw, err := os.ReadFile(file)
	if err != nil {
		return map[string]any{}
	}
	var parsed any
	if json.Unmarshal(raw, &parsed) != nil {
		return map[string]any{}
	}
	if obj, ok := parsed.(map[string]any); ok {
		return obj
	}
	return map[string]any{}
}

// Save writes settings atomically: temp file in the same directory, fsynced,
// then renamed over the target.
func Save(file string, obj map[string]any) error {
	data, err := json.MarshalIndent(obj, "", "  ")
	if err != nil {
		return err
	}
	data = append(data, '\n')

	dir := filepath.Dir(file)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return err
	}
	tmp, err := os.CreateTemp(dir, fileName+".tmp-*")
	if err != nil {
		return err
	}
	tmpName := tmp.Name()
	defer os.Remove(tmpName) // no-op after successful rename

	if _, err := tmp.Write(data); err != nil {
		tmp.Close()
		return err
	}
	if err := tmp.Sync(); err != nil {
		tmp.Close()
		return err
	}
	if err := tmp.Close(); err != nil {
		return err
	}
	if err := os.Rename(tmpName, file); err != nil {
		return fmt.Errorf("rename %s: %w", tmpName, err)
	}
	return nil
}
