// Package spec parses and validates the normka JSON instruction spec.
package spec

import (
	"encoding/json"
	"fmt"
)

// SupportedVersion is the only accepted schema version.
const SupportedVersion = 1

// Spec is the top-level instruction document.
type Spec struct {
	Version    int    `json:"version"`
	Name       string `json:"name"`
	DurationMS int    `json:"duration_ms"`
	Steps      []Step `json:"steps"`
}

// Step is a single instruction. Handlers receive the original JSON bytes
// in Raw so they can decode only the fields they care about.
type Step struct {
	Kind string          `json:"kind"`
	Raw  json.RawMessage `json:"-"`
}

// ErrVersion signals an unsupported spec version.
type ErrVersion struct{ Version int }

func (e *ErrVersion) Error() string {
	return fmt.Sprintf("unsupported version %d", e.Version)
}

// Parse decodes raw JSON bytes into a validated Spec.
func Parse(raw []byte) (*Spec, error) {
	var probe struct {
		Version int              `json:"version"`
		Name    string           `json:"name"`
		DurMS   int              `json:"duration_ms"`
		Steps   []map[string]any `json:"steps"`
	}
	if err := json.Unmarshal(raw, &probe); err != nil {
		return nil, err
	}
	if probe.Version != SupportedVersion {
		return nil, &ErrVersion{Version: probe.Version}
	}
	s := &Spec{
		Version:    probe.Version,
		Name:       probe.Name,
		DurationMS: probe.DurMS,
	}
	for _, m := range probe.Steps {
		kind, _ := m["kind"].(string)
		rb, err := json.Marshal(m)
		if err != nil {
			return nil, err
		}
		s.Steps = append(s.Steps, Step{Kind: kind, Raw: rb})
	}
	return s, nil
}
