package executor

import (
	"bytes"
	"io"
	"testing"
)

func TestDispatch_UnknownKindErrors(t *testing.T) {
	var out bytes.Buffer
	err := Dispatch([]byte(`{"version":1,"steps":[{"kind":"nope"}]}`), &out, nil)
	if err == nil {
		t.Fatal("expected error for unknown kind")
	}
}

func TestDispatch_EmptyStepsOK(t *testing.T) {
	var out bytes.Buffer
	if err := Dispatch([]byte(`{"version":1,"steps":[]}`), &out, io.Discard); err != nil {
		t.Fatal(err)
	}
}
