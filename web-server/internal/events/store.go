package events

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
)

func eventsDir(stateDir string) string {
	return filepath.Join(stateDir, "events")
}

// eventFile returns <stateDir>/events/<runId>.jsonl, matching Node store.ts.
func eventFile(stateDir, runID string) string {
	return filepath.Join(eventsDir(stateDir), runID+".jsonl")
}

// discussFile returns <stateDir>/events/<runId>.discuss.jsonl, matching Node discuss-store.ts.
func discussFile(stateDir, runID string) string {
	return filepath.Join(eventsDir(stateDir), runID+".discuss.jsonl")
}

// appendJSONL appends one JSON object as a single line (POSIX append).
func appendJSONL(path string, v any) error {
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	f, err := os.OpenFile(path, os.O_APPEND|os.O_WRONLY|os.O_CREATE, 0o644)
	if err != nil {
		return err
	}
	defer f.Close()
	raw, err := json.Marshal(v)
	if err != nil {
		return err
	}
	raw = append(raw, '\n')
	_, err = f.Write(raw)
	return err
}

func splitLines(raw []byte) []string {
	text := string(raw)
	if text == "" {
		return nil
	}
	lines := strings.Split(text, "\n")
	if len(lines) > 0 && lines[len(lines)-1] == "" {
		lines = lines[:len(lines)-1]
	}
	return lines
}

// readEvents loads stored events for a run. Missing file returns nil.
func readEvents(stateDir, runID string) ([]Event, error) {
	raw, err := os.ReadFile(eventFile(stateDir, runID))
	if os.IsNotExist(err) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return parseEvents(raw), nil
}

func parseEvents(raw []byte) []Event {
	var out []Event
	for _, line := range splitLines(raw) {
		if line == "" {
			continue
		}
		var e Event
		if err := json.Unmarshal([]byte(line), &e); err != nil {
			continue // skip malformed, matching Node
		}
		out = append(out, e)
	}
	return out
}

func maxSeq(events []Event) int {
	m := 0
	for _, e := range events {
		if e.Seq > m {
			m = e.Seq
		}
	}
	return m
}

// readEventsSince returns events with seq > sinceSeq.
func readEventsSince(stateDir, runID string, sinceSeq int) ([]Event, error) {
	events, err := readEvents(stateDir, runID)
	if err != nil {
		return nil, err
	}
	var out []Event
	for _, e := range events {
		if e.Seq > sinceSeq {
			out = append(out, e)
		}
	}
	return out, nil
}

// readAllEvents reads every *.jsonl (excluding *.discuss.jsonl) in the events
// dir and sorts by seq, matching Node replayAll.
func readAllEvents(stateDir string) ([]Event, error) {
	dir := eventsDir(stateDir)
	entries, err := os.ReadDir(dir)
	if os.IsNotExist(err) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	var all []Event
	for _, entry := range entries {
		name := entry.Name()
		if !strings.HasSuffix(name, ".jsonl") || strings.HasSuffix(name, ".discuss.jsonl") {
			continue
		}
		runID := strings.TrimSuffix(name, ".jsonl")
		events, err := readEvents(stateDir, runID)
		if err != nil {
			continue
		}
		all = append(all, events...)
	}
	sort.Slice(all, func(i, j int) bool { return all[i].Seq < all[j].Seq })
	return all, nil
}

// readDiscuss loads the discuss thread for a run. Missing file returns an empty slice.
func readDiscuss(stateDir, runID string) ([]DiscussEntry, error) {
	raw, err := os.ReadFile(discussFile(stateDir, runID))
	if os.IsNotExist(err) {
		return []DiscussEntry{}, nil
	}
	if err != nil {
		return nil, err
	}
	return parseDiscuss(raw), nil
}

func parseDiscuss(raw []byte) []DiscussEntry {
	var out []DiscussEntry
	for _, line := range splitLines(raw) {
		if line == "" {
			continue
		}
		var d map[string]any
		if err := json.Unmarshal([]byte(line), &d); err != nil {
			continue
		}
		if _, ok := d["id"].(string); !ok {
			continue
		}
		if _, ok := d["from"].(string); !ok {
			continue
		}
		if _, ok := d["kind"].(string); !ok {
			continue
		}
		var e DiscussEntry
		// Decode twice: first to validate shape, then into the struct.
		_ = json.Unmarshal([]byte(line), &e)
		out = append(out, e)
	}
	return out
}

// nextDiscussID returns the next "mN" id for a run thread.
func nextDiscussID(stateDir, runID string) (string, error) {
	entries, err := readDiscuss(stateDir, runID)
	if err != nil {
		return "", err
	}
	max := 0
	for _, e := range entries {
		var n int
		if _, err := fmt.Sscanf(e.ID, "m%d", &n); err == nil && n > max {
			max = n
		}
	}
	return fmt.Sprintf("m%d", max+1), nil
}

// unansweredQuestions returns questions with no matching answer replyTo.
func unansweredQuestions(stateDir, runID string) ([]DiscussEntry, error) {
	entries, err := readDiscuss(stateDir, runID)
	if err != nil {
		return nil, err
	}
	answered := make(map[string]bool)
	for _, e := range entries {
		if e.Kind == KindAnswer && e.ReplyTo != "" {
			answered[e.ReplyTo] = true
		}
	}
	out := make([]DiscussEntry, 0)
	for _, e := range entries {
		if e.Kind == KindQuestion && !answered[e.ID] {
			out = append(out, e)
		}
	}
	return out, nil
}
