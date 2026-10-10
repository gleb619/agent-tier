package executor

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"mock-agent/internal/spec"
)

func TestFile_Write(t *testing.T) {
	dir := t.TempDir()
	p := filepath.Join(dir, "x.txt")
	step := spec.Step{Kind: "file", Raw: []byte(`{"kind":"file","path":"` + p + `","content":"hi"}`)}
	if err := registry["file"](step, nil); err != nil {
		t.Fatal(err)
	}
	got, _ := os.ReadFile(p)
	if string(got) != "hi" {
		t.Fatalf("got %q", got)
	}
}

func TestFile_RejectsAbsoluteNonTmp(t *testing.T) {
	step := spec.Step{Kind: "file", Raw: []byte(`{"kind":"file","path":"/etc/passwd","content":"x"}`)}
	if err := registry["file"](step, nil); err == nil {
		t.Fatal("expected error on absolute non-tmp path")
	}
}

func TestFile_RejectsTraversal(t *testing.T) {
	step := spec.Step{Kind: "file", Raw: []byte(`{"kind":"file","path":"../escape.txt","content":"x"}`)}
	err := registry["file"](step, nil)
	if err == nil {
		t.Fatal("expected error on parent-traversal path")
	}
	if !strings.Contains(err.Error(), "unsafe") {
		t.Fatalf("unexpected error: %v", err)
	}
}
