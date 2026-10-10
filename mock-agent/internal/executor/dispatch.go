// Package executor dispatches Spec.Steps to per-kind handlers.
package executor

import (
	"encoding/json"
	"fmt"
	"io"

	"mock-agent/internal/spec"
)

// Handler runs a single step. It must write any human output to stdout.
type Handler func(step spec.Step, stdout io.Writer) error

// registry maps kind → handler. Populated via Register (called from
// init() in each kind file).
var registry = map[string]Handler{}

// Register binds a kind name to its handler. Idempotent.
func Register(kind string, h Handler) { registry[kind] = h }

// Dispatch runs every step sequentially, returning the first error.
func Dispatch(raw []byte, stdout io.Writer, _ io.Writer) error {
	s, err := spec.Parse(raw)
	if err != nil {
		return err
	}
	for i, step := range s.Steps {
		h, ok := registry[step.Kind]
		if !ok {
			return fmt.Errorf("step %d: unknown kind %q", i, step.Kind)
		}
		if err := h(step, stdout); err != nil {
			return fmt.Errorf("step %d (%s): %w", i, step.Kind, err)
		}
	}
	return nil
}

// jsonDecode is a tiny helper used by every handler.
func jsonDecode(raw []byte, into any) error { return json.Unmarshal(raw, into) }
