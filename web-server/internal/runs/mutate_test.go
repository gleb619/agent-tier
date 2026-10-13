package runs

import (
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"time"
)

// iso builds a JS-style timestamp relative to so fixtures never cross the
// 24h prune TTL.
func iso(offset time.Duration) string {
	return time.Now().Add(offset).UTC().Format("2006-01-02T15:04:05.000Z07:00")
}

func runJSON(id, startedAt, status string, pid int) string {
	return `{"runId":` + strconv.Quote(id) + `,"agent":"mock","tier":4,"pid":` + strconv.Itoa(pid) +
		`,"prompt":"hello world","logFile":"/tmp/at-test-missing.log","startedAt":` + strconv.Quote(startedAt) +
		`,"finishedAt":null,"exitCode":null,"status":` + strconv.Quote(status) + `,"name":"unnamed"}`
}

// writeFixtureRuns writes runs.jsonl and returns the state dir.
func writeFixtureRuns(t *testing.T, lines ...string) string {
	t.Helper()
	dir := t.TempDir()
	content := strings.Join(lines, "\n")
	if content != "" {
		content += "\n"
	}
	if err := os.WriteFile(filepath.Join(dir, runsFile), []byte(content), 0o644); err != nil {
		t.Fatal(err)
	}
	return dir
}

func readRunsFile(t *testing.T, dir string) string {
	t.Helper()
	raw, err := os.ReadFile(filepath.Join(dir, runsFile))
	if err != nil {
		t.Fatal(err)
	}
	return string(raw)
}

func TestPathToLockName(t *testing.T) {
	// Mirrors pathToLockName in src/lock.ts: strip leading "/", lowercase,
	// replace "/" and "." with "-", append ".lock".
	got := pathToLockName("/tmp/At-State/runs.jsonl")
	want := "tmp-at-state-runs-jsonl.lock"
	if got != want {
		t.Fatalf("pathToLockName = %q, want %q", got, want)
	}
}

func TestWithLockSerializesAndCleansUp(t *testing.T) {
	dir := writeFixtureRuns(t, runJSON("r1", iso(0), "running", 999999))
	file := filepath.Join(dir, runsFile)

	done := make(chan error, 2)
	for i := 0; i < 2; i++ {
		go func() {
			done <- WithLock(file, func() error { return nil })
		}()
	}
	for i := 0; i < 2; i++ {
		if err := <-done; err != nil {
			t.Fatalf("WithLock: %v", err)
		}
	}

	// Lock file must be released (removed) after use.
	entries, err := os.ReadDir(filepath.Join(dir, "locks"))
	if err != nil {
		t.Fatalf("read locks dir: %v", err)
	}
	if len(entries) != 0 {
		t.Fatalf("expected no leftover locks, found %d", len(entries))
	}
}

func TestWithLockStealsStaleLockFromDeadPid(t *testing.T) {
	dir := writeFixtureRuns(t, runJSON("r1", iso(0), "running", 999999))
	file := filepath.Join(dir, runsFile)

	lockDir := filepath.Join(dir, "locks")
	if err := os.MkdirAll(lockDir, 0o755); err != nil {
		t.Fatal(err)
	}
	// A lock held by a pid that cannot exist.
	stale := `{"pid":2147480000,"hostname":"x","startedAt":"2026-01-01T00:00:00.000Z","stateFile":"` + file + `"}`
	if err := os.WriteFile(filepath.Join(lockDir, pathToLockName(file)), []byte(stale), 0o644); err != nil {
		t.Fatal(err)
	}

	if err := WithLock(file, func() error { return nil }); err != nil {
		t.Fatalf("WithLock should steal stale lock: %v", err)
	}
}

func TestWithLockTimesOutOnLiveHolder(t *testing.T) {
	dir := writeFixtureRuns(t, runJSON("r1", iso(0), "running", 999999))
	file := filepath.Join(dir, runsFile)

	lockDir := filepath.Join(dir, "locks")
	if err := os.MkdirAll(lockDir, 0o755); err != nil {
		t.Fatal(err)
	}
	// Our own pid is definitely alive.
	stale := `{"pid":` + strconv.Itoa(os.Getpid()) + `,"hostname":"x","startedAt":"` + time.Now().UTC().Format("2006-01-02T15:04:05.000Z07:00") + `","stateFile":"` + file + `"}`
	if err := os.WriteFile(filepath.Join(lockDir, pathToLockName(file)), []byte(stale), 0o644); err != nil {
		t.Fatal(err)
	}

	start := time.Now()
	err := WithLockTimeout(file, func() error { return nil }, 200*time.Millisecond)
	if err == nil {
		t.Fatal("expected timeout error on live lock holder")
	}
	if time.Since(start) < 150*time.Millisecond {
		t.Fatalf("returned before timeout: %v", time.Since(start))
	}
}

func TestUpdateRunMarksFailed(t *testing.T) {
	dir := writeFixtureRuns(t,
		runJSON("r1", iso(-time.Minute), "running", 999999),
		runJSON("r2", iso(-2*time.Minute), "running", 999999),
	)

	finishedAt := NowISO(time.Now())
	if err := UpdateRun(dir, "r1", map[string]any{"status": "failed", "finishedAt": finishedAt}); err != nil {
		t.Fatalf("UpdateRun: %v", err)
	}

	runs := LoadRuns(dir)
	if len(runs) != 2 {
		t.Fatalf("expected 2 runs, got %d", len(runs))
	}
	if runs[0].RunID != "r1" || runs[1].RunID != "r2" {
		t.Fatalf("UpdateRun reordered runs: %v, %v", runs[0].RunID, runs[1].RunID)
	}
	if runs[0].Status != "failed" || runs[0].FinishedAt == nil || *runs[0].FinishedAt != finishedAt {
		t.Fatalf("r1 not marked failed: %+v", runs[0])
	}
	if runs[1].Status != "running" {
		t.Fatalf("r2 should be untouched: %+v", runs[1])
	}
	// Trailing newline preserved (writeJsonl contract).
	if !strings.HasSuffix(readRunsFile(t, dir), "\n") {
		t.Fatal("runs.jsonl missing trailing newline")
	}
}

func TestUpdateRunUnknownIdIsNoop(t *testing.T) {
	dir := writeFixtureRuns(t, runJSON("r1", iso(0), "running", 999999))
	before := readRunsFile(t, dir)
	if err := UpdateRun(dir, "nope", map[string]any{"status": "failed"}); err != nil {
		t.Fatalf("UpdateRun: %v", err)
	}
	if readRunsFile(t, dir) != before {
		t.Fatal("UpdateRun on unknown id must not rewrite the file")
	}
}
