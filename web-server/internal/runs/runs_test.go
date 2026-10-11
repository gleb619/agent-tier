package runs

import (
	"os"
	"path/filepath"
	"reflect"
	"strconv"
	"testing"
	"time"
)

const runningLine = `{"runId":"a1b2c3","agent":"mock","tier":4,"pid":999999,"prompt":"fix the bug","logFile":"/tmp/missing.log","startedAt":"2026-10-11T10:00:00.000Z","finishedAt":null,"exitCode":null,"status":"running","name":"unnamed"}`

const doneLine = `{"runId":"d4e5f6","agent":"glm-code","tier":1,"pid":12345,"prompt":"review code","logFile":"/tmp/gone.log","startedAt":"2026-10-11T09:00:00.000Z","finishedAt":"2026-10-11T09:05:00.000Z","exitCode":0,"status":"done","name":"review session"}`

func writeRunsFile(t *testing.T, lines ...string) string {
	t.Helper()
	dir := t.TempDir()
	content := ""
	for _, l := range lines {
		content += l + "\n"
	}
	if err := os.WriteFile(filepath.Join(dir, "runs.jsonl"), []byte(content), 0o644); err != nil {
		t.Fatal(err)
	}
	return dir
}

func TestLoadRunsJSONL(t *testing.T) {
	dir := writeRunsFile(t, runningLine, doneLine)
	got := LoadRuns(dir)
	if len(got) != 2 {
		t.Fatalf("LoadRuns len = %d, want 2", len(got))
	}
	if got[0].RunID != "a1b2c3" || got[0].Tier != 4 || got[0].FinishedAt != nil || got[0].ExitCode != nil {
		t.Fatalf("unexpected first record: %+v", got[0])
	}
	if got[1].Status != "done" || got[1].ExitCode == nil || *got[1].ExitCode != 0 {
		t.Fatalf("unexpected second record: %+v", got[1])
	}
}

func TestLoadRunsLegacyIndexFormat(t *testing.T) {
	dir := writeRunsFile(t, `{"runs":[`+runningLine+`]}`)
	got := LoadRuns(dir)
	if len(got) != 1 || got[0].RunID != "a1b2c3" {
		t.Fatalf("LoadRuns legacy = %+v, want one record a1b2c3", got)
	}
}

func TestLoadRunsMissingFile(t *testing.T) {
	if got := LoadRuns(t.TempDir()); len(got) != 0 {
		t.Fatalf("LoadRuns missing = %v, want empty", got)
	}
}

func TestLoadRunsMalformedLineReturnsEmpty(t *testing.T) {
	// Node readJsonl: any JSON.parse failure on the non-legacy path drops the whole list.
	dir := writeRunsFile(t, runningLine, "{not json")
	if got := LoadRuns(dir); len(got) != 0 {
		t.Fatalf("LoadRuns malformed = %v, want empty", got)
	}
}

func TestMaxRunsFromStateJSON(t *testing.T) {
	dir := t.TempDir()
	if got := MaxRuns(dir); got != 30 {
		t.Fatalf("MaxRuns default = %d, want 30", got)
	}
	state := `{"runs":{"maxEntries":5}}`
	if err := os.WriteFile(filepath.Join(dir, "state.json"), []byte(state), 0o644); err != nil {
		t.Fatal(err)
	}
	if got := MaxRuns(dir); got != 5 {
		t.Fatalf("MaxRuns = %d, want 5", got)
	}
	state = `{"runs":{"maxEntries":0}}`
	if err := os.WriteFile(filepath.Join(dir, "state.json"), []byte(state), 0o644); err != nil {
		t.Fatal(err)
	}
	if got := MaxRuns(dir); got != 1 {
		t.Fatalf("MaxRuns(0) = %d, want 1", got)
	}
}

func mkRun(id, startedAt, status string) RunRecord {
	return RunRecord{
		RunID: id, Agent: "mock", Tier: 4, Pid: 999999, Prompt: "p",
		LogFile: "/tmp/missing.log", StartedAt: startedAt, FinishedAt: nil,
		ExitCode: nil, Status: status, Name: "unnamed",
	}
}

func TestPruneListTTLAndSortAndCap(t *testing.T) {
	iso := func(offset time.Duration) string {
		return time.Now().Add(offset).UTC().Format("2006-01-02T15:04:05.000Z07:00")
	}
	list := []RunRecord{
		mkRun("old", iso(-48*time.Hour), "done"),
		mkRun("new", iso(-30*time.Minute), "running"),
		mkRun("mid", iso(-5*time.Hour), "failed"),
	}
	got := PruneList(list, 24*time.Hour, 30)
	ids := []string{got[0].RunID, got[1].RunID}
	if !reflect.DeepEqual(ids, []string{"new", "mid"}) {
		t.Fatalf("PruneList order = %v, want [new mid]", ids)
	}
	if got := PruneList(list, time.Hour, 30); len(got) != 1 || got[0].RunID != "new" {
		t.Fatalf("PruneList ttl1h = %+v, want only [new]", got)
	}
	if got := PruneList(list, 24*time.Hour, 2); len(got) != 2 {
		t.Fatalf("PruneList cap2 len = %d, want 2", len(got))
	}
}

func TestDetectStuckDeadPidFails(t *testing.T) {
	now := time.Date(2026, 10, 11, 12, 0, 0, 0, time.UTC)
	in := []RunRecord{mkRun("a1b2c3", "2026-10-11T10:00:00.000Z", "running")}
	out := DetectStuck(in, DetectOpts{
		Now:      func() time.Time { return now },
		PidAlive: func(int) bool { return false },
	})
	r := out[0]
	if r.Status != "failed" || r.FinishedAt == nil || r.ExitCode != nil {
		t.Fatalf("dead pid run = %+v, want failed with finishedAt", r)
	}
	if *r.FinishedAt != "2026-10-11T12:00:00.000Z" {
		t.Fatalf("finishedAt = %q, want ISO now", *r.FinishedAt)
	}
}

func TestDetectStuckSilentLog(t *testing.T) {
	now := time.Date(2026, 10, 11, 12, 0, 0, 0, time.UTC)
	dir := t.TempDir()
	staleLog := filepath.Join(dir, "stale.log")
	if err := os.WriteFile(staleLog, []byte("old\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	stale := time.Date(2026, 10, 11, 10, 0, 0, 0, time.UTC)
	if err := os.Chtimes(staleLog, stale, stale); err != nil {
		t.Fatal(err)
	}
	freshLog := filepath.Join(dir, "fresh.log")
	if err := os.WriteFile(freshLog, []byte("new\n"), 0o644); err != nil {
		t.Fatal(err)
	}

	in := []RunRecord{
		mkRun("silent", "2026-10-11T10:00:00.000Z", "running"),
		mkRun("active", "2026-10-11T10:00:00.000Z", "running"),
		mkRun("nolog", "2026-10-11T05:00:00.000Z", "running"),
		mkRun("done-run", "2026-10-11T05:00:00.000Z", "done"),
	}
	in[0].LogFile = staleLog
	in[1].LogFile = freshLog
	in[2].LogFile = filepath.Join(dir, "missing.log")

	out := DetectStuck(in, DetectOpts{
		Now:      func() time.Time { return now },
		PidAlive: func(int) bool { return true },
	})
	if out[0].Status != "stuck" {
		t.Fatalf("stale log run = %s, want stuck", out[0].Status)
	}
	if out[1].Status != "running" {
		t.Fatalf("fresh log run = %s, want running", out[1].Status)
	}
	// Missing log: silence measured from startedAt (7h ago > 30min).
	if out[2].Status != "stuck" {
		t.Fatalf("missing log run = %s, want stuck", out[2].Status)
	}
	if out[3].Status != "done" {
		t.Fatalf("done run = %s, want untouched", out[3].Status)
	}
}

func TestDetectStuckDoesNotMutateInput(t *testing.T) {
	in := []RunRecord{mkRun("a1b2c3", "2026-10-11T10:00:00.000Z", "running")}
	DetectStuck(in, DetectOpts{Now: time.Now, PidAlive: func(int) bool { return false }})
	if in[0].Status != "running" {
		t.Fatal("DetectStuck mutated the input slice")
	}
}

func TestJoinRunsSingleDirNoScope(t *testing.T) {
	dirs := []string{"/p1"}
	per := [][]RunRecord{{{RunID: "a", Status: "done"}}}
	got := JoinRuns(dirs, per)
	if len(got) != 1 || got[0].Scope != "" {
		t.Fatalf("JoinRuns single = %+v, want no scope", got)
	}
}

func TestJoinRunsProjectWinsAndScopes(t *testing.T) {
	home := t.TempDir()
	t.Setenv("HOME", home)
	global := filepath.Join(home, ".at")
	project := "/proj/.at"
	dirs := []string{project, global}
	per := [][]RunRecord{
		{{RunID: "shared", Status: "done", StartedAt: "2026-10-11T09:00:00.000Z"}, {RunID: "p1", Status: "running", StartedAt: "2026-10-11T08:00:00.000Z"}},
		{{RunID: "shared", Status: "failed", StartedAt: "2026-10-11T11:00:00.000Z"}, {RunID: "g1", Status: "done", StartedAt: "2026-10-11T10:00:00.000Z"}},
	}
	got := JoinRuns(dirs, per)
	ids := []string{}
	scopes := map[string]string{}
	for _, r := range got {
		ids = append(ids, r.RunID)
		scopes[r.RunID] = r.Scope
	}
	// Newest first; "shared" keeps the project copy despite the newer global one.
	if !reflect.DeepEqual(ids, []string{"g1", "shared", "p1"}) {
		t.Fatalf("JoinRuns order = %v, want [g1 shared p1]", ids)
	}
	if scopes["shared"] != "project" || scopes["g1"] != "global" || scopes["p1"] != "project" {
		t.Fatalf("scopes = %v", scopes)
	}
}

func TestFindRunExactPrefixAndAcrossDirs(t *testing.T) {
	dirA := writeRunsFile(t, runningLine) // a1b2c3
	dirB := writeRunsFile(t, doneLine)    // d4e5f6
	dirs := []string{dirA, dirB}

	if r, _, ok := FindRun(dirs, "a1b2c3"); !ok || r.RunID != "a1b2c3" {
		t.Fatalf("exact match failed: %+v %v", r, ok)
	}
	if r, _, ok := FindRun(dirs, "a1b2c"); !ok || r.RunID != "a1b2c3" {
		t.Fatalf("prefix match failed: %+v %v", r, ok)
	}
	if r, _, ok := FindRun(dirs, "d4e5f"); !ok || r.RunID != "d4e5f6" {
		t.Fatalf("second dir match failed: %+v %v", r, ok)
	}
	if _, _, ok := FindRun(dirs, "nope"); ok {
		t.Fatal("FindRun(nope) should miss")
	}
	// Earlier dir wins on shared ids.
	dirC := writeRunsFile(t, `{"runId":"a1ffff","agent":"mock","tier":4,"pid":1,"prompt":"p","logFile":"/tmp/x","startedAt":"2026-10-11T10:00:00.000Z","finishedAt":null,"exitCode":null,"status":"running","name":"unnamed"}`)
	if r, _, ok := FindRun([]string{dirA, dirC}, "a1"); !ok || r.RunID != "a1b2c3" {
		t.Fatalf("dir precedence failed: %+v %v", r, ok)
	}
}

func TestTailLines(t *testing.T) {
	dir := t.TempDir()
	log := filepath.Join(dir, "run.log")
	content := ""
	for i := 0; i < 300; i++ {
		content += "line " + strconv.Itoa(i) + "\n"
	}
	if err := os.WriteFile(log, []byte(content), 0o644); err != nil {
		t.Fatal(err)
	}
	lines, err := TailLines(log, 50)
	if err != nil {
		t.Fatal(err)
	}
	if len(lines) != 50 || lines[0] != "line 250" || lines[49] != "line 299" {
		t.Fatalf("tail = %d lines, first=%q last=%q", len(lines), lines[0], lines[49])
	}
	lines, err = TailLines(log, 1000)
	if err != nil || len(lines) != 300 {
		t.Fatalf("tail overflow = %d lines err=%v, want 300", len(lines), err)
	}
	if _, err := TailLines(filepath.Join(dir, "missing.log"), 10); err == nil {
		t.Fatal("TailLines missing file should error")
	}
}
