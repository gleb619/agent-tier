package executor

import (
	"io"
	"os"
	"path/filepath"
	"strings"

	"mock-agent/internal/spec"
)

func init() { Register("file", fileStep) }

type fileArgs struct {
	Path    string `json:"path"`
	Content string `json:"content"`
}

func fileStep(step spec.Step, _ io.Writer) error {
	var a fileArgs
	if err := jsonDecode(step.Raw, &a); err != nil {
		return err
	}
	if !isSafePath(a.Path) {
		return &ErrUnsafePath{Path: a.Path}
	}
	if err := os.MkdirAll(filepath.Dir(a.Path), 0o755); err != nil {
		return err
	}
	return os.WriteFile(a.Path, []byte(a.Content), 0o644)
}

// ErrUnsafePath signals a rejected filesystem path.
type ErrUnsafePath struct{ Path string }

func (e *ErrUnsafePath) Error() string { return "unsafe path: " + e.Path }

// isSafePath restricts absolute paths and parent traversal; allows /tmp/*,
// /dev/null, and relative paths.
func isSafePath(p string) bool {
	if p == "" || strings.HasPrefix(p, "..") {
		return false
	}
	if filepath.IsAbs(p) && !strings.HasPrefix(p, "/tmp/") && p != "/dev/null" {
		return false
	}
	return true
}
