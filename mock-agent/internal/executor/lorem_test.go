package executor

import (
	"bytes"
	"strings"
	"testing"

	"mock-agent/internal/spec"
)

func TestLorem_EmitsParagraphs(t *testing.T) {
	step := spec.Step{Kind: "lorem", Raw: []byte(`{"kind":"lorem","paragraphs":2}`)}
	var out bytes.Buffer
	if err := registry["lorem"](step, &out); err != nil {
		t.Fatal(err)
	}
	if got := strings.Count(out.String(), "\n"); got < 2 {
		t.Fatalf("expected >=2 paragraph lines, got %d", got)
	}
}
