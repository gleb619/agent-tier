// Package runs reads `runs.jsonl` state: load, prune (TTL + maxEntries),
// stuck detection, cross-dir join and log tailing. Read-only: nothing here
// persists back to disk — the Node CLI owns the runs file.
package runs

import (
	"encoding/json"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"syscall"
	"time"

	"web-server/internal/state"
)

// Placeholder `name` until the namer resolves (matches src/run-store.ts).
const UnnamedPlaceholder = "unnamed"

const (
	defaultMaxRuns = 30
	defaultTTL     = 24 * time.Hour
	stuckSilence   = 30 * time.Minute
	runsFile       = "runs.jsonl"
	stateFile      = "state.json"
	jsonFileMode   = 0o644
)

// RunRecord matches src/run-store.ts `RunRecord` byte-for-byte on the wire.
type RunRecord struct {
	RunID      string  `json:"runId"`
	Agent      string  `json:"agent"`
	Tier       int     `json:"tier"`
	Pid        int     `json:"pid"`
	Prompt     string  `json:"prompt"`
	LogFile    string  `json:"logFile"`
	StartedAt  string  `json:"startedAt"`
	FinishedAt *string `json:"finishedAt"`
	ExitCode   *int    `json:"exitCode"`
	Status     string  `json:"status"`
	Name       string  `json:"name"`
}

// ScopedRun is a RunRecord tagged with the state dir it came from. The scope
// field only appears when multiple state dirs are joined (omitempty), matching
// `joinRuns` in src/status.ts.
type ScopedRun struct {
	RunRecord
	Scope string `json:"scope,omitempty"`
}

func parseTime(s string) time.Time {
	t, err := time.Parse(time.RFC3339Nano, s)
	if err != nil {
		return time.Time{}
	}
	return t
}

// NowISO formats a timestamp the way JS `new Date().toISOString()` does.
func NowISO(t time.Time) string {
	return t.UTC().Format("2006-01-02T15:04:05.000Z07:00")
}

// LoadRuns parses `<dir>/runs.jsonl`. Missing file → empty. A single-line
// `{"runs":[...]}` legacy index is accepted. Any malformed line on the JSONL
// path drops the whole list (same behavior as readJsonl in src/run-store.ts).
func LoadRuns(dir string) []RunRecord {
	raw, err := os.ReadFile(filepath.Join(dir, runsFile))
	if err != nil {
		return nil
	}
	var lines []string
	for _, l := range strings.Split(string(raw), "\n") {
		if strings.TrimSpace(l) != "" {
			lines = append(lines, l)
		}
	}
	if len(lines) == 1 {
		var legacy struct {
			Runs []RunRecord `json:"runs"`
		}
		if json.Unmarshal([]byte(lines[0]), &legacy) == nil && legacy.Runs != nil {
			return legacy.Runs
		}
	}
	var out []RunRecord
	for _, l := range lines {
		var r RunRecord
		if err := json.Unmarshal([]byte(l), &r); err != nil {
			return nil
		}
		out = append(out, r)
	}
	return out
}

// MaxRuns reads `runs.maxEntries` from `<dir>/state.json`, defaulting to 30
// (min 1), matching getMaxRuns in src/run-store.ts.
func MaxRuns(dir string) int {
	raw, err := os.ReadFile(filepath.Join(dir, stateFile))
	if err != nil {
		return defaultMaxRuns
	}
	var state struct {
		Runs *struct {
			MaxEntries *float64 `json:"maxEntries"`
		} `json:"runs"`
	}
	if json.Unmarshal(raw, &state) != nil || state.Runs == nil || state.Runs.MaxEntries == nil {
		return defaultMaxRuns
	}
	m := int(*state.Runs.MaxEntries)
	if m < 1 {
		return 1
	}
	return m
}

// PruneList filters runs older than ttl (by finishedAt, else startedAt),
// sorts newest first and caps at maxRuns. Pure: no I/O.
func PruneList(list []RunRecord, ttl time.Duration, maxRuns int) []RunRecord {
	cutoff := time.Now().Add(-ttl)
	var filtered []RunRecord
	for _, r := range list {
		end := parseTime(r.StartedAt)
		if r.FinishedAt != nil {
			if t := parseTime(*r.FinishedAt); !t.IsZero() {
				end = t
			}
		}
		if !end.Before(cutoff) {
			filtered = append(filtered, r)
		}
	}
	sort.SliceStable(filtered, func(i, j int) bool {
		return parseTime(filtered[i].StartedAt).After(parseTime(filtered[j].StartedAt))
	})
	if len(filtered) > maxRuns {
		filtered = filtered[:maxRuns]
	}
	return filtered
}

// DetectOpts injects the clock, liveness probe and log-mtime source so tests
// can pin all three.
type DetectOpts struct {
	Now      func() time.Time
	PidAlive func(pid int) bool
}

func logMtime(logFile string) (time.Time, bool) {
	info, err := os.Stat(logFile)
	if err != nil {
		return time.Time{}, false
	}
	return info.ModTime(), true
}

// DetectStuck annotates running runs: a dead pid becomes `failed` (finishedAt
// set, exitCode null); a run whose log has been silent for 30+ minutes
// becomes `stuck`. When the log file is missing, silence is measured from
// startedAt. Returns annotated copies; the input is not mutated and nothing
// is persisted (read-only core — the Node CLI owns runs.jsonl).
func DetectStuck(list []RunRecord, opts DetectOpts) []RunRecord {
	now := opts.Now()
	out := make([]RunRecord, len(list))
	copy(out, list)
	for i := range out {
		r := &out[i]
		if r.Status != "running" {
			continue
		}
		if !opts.PidAlive(r.Pid) {
			ts := NowISO(now)
			r.Status = "failed"
			r.FinishedAt = &ts
			r.ExitCode = nil
			continue
		}
		var silence time.Duration
		if mt, ok := logMtime(r.LogFile); ok {
			silence = now.Sub(mt)
		} else {
			silence = now.Sub(parseTime(r.StartedAt))
		}
		if silence > stuckSilence {
			r.Status = "stuck"
		}
	}
	return out
}

// PidAlive reports whether pid is running (signal 0 probe). EPERM counts as
// alive — the process exists but is owned by someone else.
func PidAlive(pid int) bool {
	if pid <= 0 {
		return false
	}
	err := syscall.Kill(pid, 0)
	return err == nil || err == syscall.EPERM
}

// JoinRuns merges per-dir run lists. A single dir is returned untagged
// (back-compat); multiple dirs dedupe by runId (earlier dir wins), tag scope
// and sort newest first — matching joinRuns in src/status.ts.
func JoinRuns(dirs []string, runsPerDir [][]RunRecord) []ScopedRun {
	if len(dirs) <= 1 {
		var out []ScopedRun
		for _, r := range runsPerDir[0] {
			out = append(out, ScopedRun{RunRecord: r})
		}
		return out
	}
	byID := make(map[string]ScopedRun)
	var order []string
	for i, dir := range dirs {
		scope := ScopeOf(dir)
		for _, r := range runsPerDir[i] {
			if _, seen := byID[r.RunID]; !seen {
				byID[r.RunID] = ScopedRun{RunRecord: r, Scope: scope}
				order = append(order, r.RunID)
			}
		}
	}
	out := make([]ScopedRun, 0, len(order))
	for _, id := range order {
		out = append(out, byID[id])
	}
	sort.SliceStable(out, func(i, j int) bool {
		return parseTime(out[i].StartedAt).After(parseTime(out[j].StartedAt))
	})
	return out
}

func ScopeOf(dir string) string {
	return state.ScopeOf(dir)
}

// FindRun locates a run by full or prefix id across the joined dirs
// (dir order = precedence), like findRun in src/web/server.ts. Returns the
// raw stored record — no status annotation.
func FindRun(dirs []string, id string) (RunRecord, string, bool) {
	if id == "" {
		return RunRecord{}, "", false
	}
	for _, dir := range dirs {
		for _, r := range LoadRuns(dir) {
			if r.RunID == id || strings.HasPrefix(r.RunID, id) {
				return r, dir, true
			}
		}
	}
	return RunRecord{}, "", false
}

// TailLines returns the last n lines of logFile. A trailing newline does not
// produce an empty final line. Missing/unreadable files error (caller → 404).
func TailLines(logFile string, n int) ([]string, error) {
	raw, err := os.ReadFile(logFile)
	if err != nil {
		return nil, err
	}
	lines := strings.Split(string(raw), "\n")
	if len(lines) > 0 && lines[len(lines)-1] == "" {
		lines = lines[:len(lines)-1]
	}
	if n < len(lines) {
		lines = lines[len(lines)-n:]
	}
	return lines, nil
}
