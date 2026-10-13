package api

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func writeRunsFile(t *testing.T, lines ...string) string {
	t.Helper()
	dir := t.TempDir()
	content := strings.Join(lines, "\n")
	if content != "" {
		content += "\n"
	}
	if err := os.WriteFile(filepath.Join(dir, "runs.jsonl"), []byte(content), 0o644); err != nil {
		t.Fatal(err)
	}
	return dir
}

func runJSON(id, startedAt, status string, pid int) string {
	return fmt.Sprintf(`{"runId":%q,"agent":"mock","tier":4,"pid":%d,"prompt":"hello world","logFile":"/tmp/at-test-missing.log","startedAt":%q,"finishedAt":null,"exitCode":null,"status":%q,"name":"unnamed"}`,
		id, pid, startedAt, status)
}

func doneJSON(id, startedAt string) string {
	// Add 5 minutes to startedAt for finishedAt to make a realistic done run
	startedTime, _ := time.Parse("2006-01-02T15:04:05.000Z07:00", startedAt)
	finishedTime := startedTime.Add(5 * time.Minute)
	return fmt.Sprintf(`{"runId":%q,"agent":"mock","tier":4,"pid":999999,"prompt":"hello world","logFile":"/tmp/at-test-missing.log","startedAt":%q,"finishedAt":%q,"exitCode":0,"status":"done","name":"unnamed"}`,
		id, startedAt, finishedTime.Format("2006-01-02T15:04:05.000Z07:00"))
}

// iso builds a JS-style timestamp relative to now so fixtures never cross
// the 24h prune TTL regardless of when tests run.
func iso(offset time.Duration) string {
	return time.Now().Add(offset).UTC().Format("2006-01-02T15:04:05.000Z07:00")
}

func get(t *testing.T, h http.Handler, target string) (*http.Response, map[string]any) {
	t.Helper()
	req := httptest.NewRequest(http.MethodGet, target, nil)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	res := rec.Result()
	var body map[string]any
	_ = json.Unmarshal(rec.Body.Bytes(), &body)
	return res, body
}

func getBody(t *testing.T, h http.Handler, target string, out any) *http.Response {
	t.Helper()
	req := httptest.NewRequest(http.MethodGet, target, nil)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code == 200 {
		if err := json.Unmarshal(rec.Body.Bytes(), out); err != nil {
			t.Fatalf("decode %s: %v (%s)", target, err, rec.Body.String())
		}
	}
	return rec.Result()
}

func doJSON(t *testing.T, h http.Handler, method, target string, payload any) *httptest.ResponseRecorder {
	t.Helper()
	var body []byte
	if payload != nil {
		var err error
		body, err = json.Marshal(payload)
		if err != nil {
			t.Fatal(err)
		}
	}
	req := httptest.NewRequest(method, target, bytes.NewReader(body))
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	return rec
}

func TestRunsEmptyStateDir(t *testing.T) {
	h := New([]string{t.TempDir()}, "")
	res, _ := get(t, h, "/api/runs")
	if res.StatusCode != 200 {
		t.Fatalf("status = %d", res.StatusCode)
	}
	var runs []any
	_ = getBody(t, h, "/api/runs", &runs)
	if len(runs) != 0 {
		t.Fatalf("runs = %v, want []", runs)
	}
}

func TestRunsNewestFirstAndDeadPidFailed(t *testing.T) {
	dir := writeRunsFile(t,
		doneJSON("old-run", iso(-2*time.Hour)),
		runJSON("fresh-run", iso(-1*time.Hour), "running", 999999),
	)
	var runs []map[string]any
	getBody(t, New([]string{dir}, ""), "/api/runs", &runs)
	if len(runs) != 2 {
		t.Fatalf("runs = %d", len(runs))
	}
	if runs[0]["runId"] != "fresh-run" {
		t.Fatalf("first run = %v, want fresh-run", runs[0]["runId"])
	}
	if runs[0]["status"] != "failed" || runs[0]["finishedAt"] == nil {
		t.Fatalf("dead-pid run not annotated: %v", runs[0])
	}
	if runs[1]["status"] != "done" {
		t.Fatalf("done run status = %v", runs[1]["status"])
	}
	if _, has := runs[0]["scope"]; has {
		t.Fatal("single-dir runs must not carry a scope field")
	}
}

func TestRunsMultiDirJoinWithScope(t *testing.T) {
	home := t.TempDir()
	t.Setenv("HOME", home)
	project := writeRunsFile(t, runJSON("shared", iso(-3*time.Hour), "done", 999999))
	global := filepath.Join(home, ".at")
	if err := os.MkdirAll(global, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(global, "runs.jsonl"), []byte(runJSON("shared", iso(-3*time.Hour), "failed", 999999)+"\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	var runs []map[string]any
	getBody(t, New([]string{project, global}, ""), "/api/runs", &runs)
	if len(runs) != 1 {
		t.Fatalf("runs = %d, want 1 (deduped)", len(runs))
	}
	if runs[0]["status"] != "done" {
		t.Fatalf("project copy must win: %v", runs[0])
	}
	if runs[0]["scope"] != "project" {
		t.Fatalf("scope = %v, want project", runs[0]["scope"])
	}
}

func TestRunByIDExactPrefix404(t *testing.T) {
	dir := writeRunsFile(t, doneJSON("abcdef123456", iso(-4*time.Hour)))
	h := New([]string{dir}, "")
	for _, id := range []string{"abcdef123456", "abcdef"} {
		res, _ := get(t, h, "/api/runs/"+id)
		if res.StatusCode != 200 {
			t.Fatalf("GET /api/runs/%s = %d", id, res.StatusCode)
		}
	}
	if res, _ := get(t, h, "/api/runs/nope"); res.StatusCode != 404 {
		t.Fatalf("unknown run = %d, want 404", res.StatusCode)
	}
	var errBody map[string]any
	res, _ := get(t, h, "/api/runs/nope")
	_ = json.NewDecoder(res.Body).Decode(&errBody)
	if errBody["error"] == nil {
		t.Fatalf("error body missing: %v", errBody)
	}
}

func TestRunLogTail(t *testing.T) {
	dir := t.TempDir()
	logFile := filepath.Join(dir, "run.log")
	lines := make([]string, 300)
	for i := range lines {
		lines[i] = fmt.Sprintf("line %d", i)
	}
	if err := os.WriteFile(logFile, []byte(strings.Join(lines, "\n")+"\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	state := writeRunsFile(t, runJSON("logrun", iso(-2*time.Hour), "done", 999999))
	// Point the record at our log: rewrite the line.
	if err := os.WriteFile(filepath.Join(state, "runs.jsonl"), []byte(
		fmt.Sprintf(`{"runId":"logrun","agent":"mock","tier":4,"pid":999999,"prompt":"p","logFile":%q,"startedAt":%q,"finishedAt":null,"exitCode":null,"status":"done","name":"unnamed"}`, logFile, iso(-2*time.Hour))), 0o644); err != nil {
		t.Fatal(err)
	}
	h := New([]string{state}, "")

	var out struct {
		RunID string   `json:"runId"`
		Lines []string `json:"lines"`
	}
	getBody(t, h, "/api/runs/logrun/log?lines=50", &out)
	if len(out.Lines) != 50 || out.Lines[0] != "line 250" || out.Lines[49] != "line 299" {
		t.Fatalf("tail = %d lines first=%q last=%q", len(out.Lines), out.Lines[0], out.Lines[49])
	}
	if out.RunID != "logrun" {
		t.Fatalf("runId = %q", out.RunID)
	}
	// Default lines = 200.
	getBody(t, h, "/api/runs/logrun/log", &out)
	if len(out.Lines) != 200 {
		t.Fatalf("default tail = %d lines, want 200", len(out.Lines))
	}
	if res, _ := get(t, h, "/api/runs/nope/log"); res.StatusCode != 404 {
		t.Fatalf("unknown run log = %d", res.StatusCode)
	}
	// Missing log file → 404.
	missing := writeRunsFile(t, runJSON("nullog", iso(-2*time.Hour), "done", 999999))
	if res, _ := get(t, New([]string{missing}, ""), "/api/runs/nullog/log"); res.StatusCode != 404 {
		t.Fatalf("missing log = %d, want 404", res.StatusCode)
	}
}

func TestStats(t *testing.T) {
	// Fresh log + live pid so the "live" run stays running under stuck detection.
	freshLog := filepath.Join(t.TempDir(), "live.log")
	if err := os.WriteFile(freshLog, []byte("active\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	liveJSON := fmt.Sprintf(`{"runId":"live","agent":"mock","tier":4,"pid":%d,"prompt":"p","logFile":%q,"startedAt":%q,"finishedAt":null,"exitCode":null,"status":"running","name":"unnamed"}`,
		os.Getpid(), freshLog, iso(-1*time.Minute))
	dir := writeRunsFile(t,
		doneJSON("d1", iso(-4*time.Hour)),
		fmt.Sprintf(`{"runId":"f1","agent":"mock","tier":4,"pid":999999,"prompt":"p","logFile":"/tmp/x","startedAt":%q,"finishedAt":%q,"exitCode":1,"status":"failed","name":"unnamed"}`, iso(-4*time.Hour), iso(-3*time.Hour)),
		fmt.Sprintf(`{"runId":"f2","agent":"mock","tier":4,"pid":999999,"prompt":"p","logFile":"/tmp/x","startedAt":%q,"finishedAt":%q,"exitCode":1,"status":"failed","name":"unnamed"}`, iso(-4*time.Hour), iso(-3*time.Hour)),
		liveJSON,
	)
	var stats map[string]any
	getBody(t, New([]string{dir}, ""), "/api/stats", &stats)
	if stats["total"] != float64(4) || stats["running"] != float64(1) || stats["done"] != float64(1) || stats["failed"] != float64(2) || stats["stuck"] != float64(0) {
		t.Fatalf("stats = %v", stats)
	}
	agents, ok := stats["agents"].(map[string]any)
	if !ok || agents["total"] == nil || agents["deactivated"] == nil {
		t.Fatalf("stats.agents = %v", stats["agents"])
	}
}

func TestStatsDeactivatedAgents(t *testing.T) {
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "state.json"), []byte(
		`{"agents":{"mock":{"failureTimes":[],"disabledTo":null,"deactivated":true}}}`), 0o644); err != nil {
		t.Fatal(err)
	}
	var stats struct {
		Agents struct {
			Total       int `json:"total"`
			Deactivated int `json:"deactivated"`
		} `json:"agents"`
	}
	getBody(t, New([]string{dir}, ""), "/api/stats", &stats)
	if stats.Agents.Total != len(builtinAgents) {
		t.Fatalf("agents.total = %d, want %d", stats.Agents.Total, len(builtinAgents))
	}
	if stats.Agents.Deactivated != 1 {
		t.Fatalf("agents.deactivated = %d, want 1", stats.Agents.Deactivated)
	}
}

func TestSettingsRoundtrip(t *testing.T) {
	dir := t.TempDir()
	h := New([]string{dir}, "")

	var settings map[string]any
	getBody(t, h, "/api/settings", &settings)
	if len(settings) != 0 {
		t.Fatalf("default settings = %v, want {}", settings)
	}

	rec := doJSON(t, h, http.MethodPut, "/api/settings", map[string]any{"defaultTier": 2, "retries": 3})
	if rec.Code != 200 {
		t.Fatalf("PUT = %d %s", rec.Code, rec.Body.String())
	}
	raw, err := os.ReadFile(filepath.Join(dir, "web-settings.json"))
	if err != nil {
		t.Fatal(err)
	}
	var stored map[string]any
	if err := json.Unmarshal(raw, &stored); err != nil {
		t.Fatal(err)
	}
	if stored["defaultTier"] != float64(2) || stored["retries"] != float64(3) {
		t.Fatalf("stored = %v", stored)
	}
	getBody(t, h, "/api/settings", &settings)
	if settings["defaultTier"] != float64(2) {
		t.Fatalf("after PUT GET = %v", settings)
	}

	if rec := doJSON(t, h, http.MethodPut, "/api/settings", []any{1, 2}); rec.Code != 400 {
		t.Fatalf("PUT array = %d, want 400", rec.Code)
	}
	if rec := doJSON(t, h, http.MethodPut, "/api/settings", "nope"); rec.Code != 400 {
		t.Fatalf("PUT string = %d, want 400", rec.Code)
	}
	req := httptest.NewRequest(http.MethodPut, "/api/settings", strings.NewReader("{broken"))
	rec2 := httptest.NewRecorder()
	h.ServeHTTP(rec2, req)
	if rec2.Code != 400 {
		t.Fatalf("PUT broken JSON = %d, want 400", rec2.Code)
	}
}

func TestSettingsBodyCap(t *testing.T) {
	h := New([]string{t.TempDir()}, "")
	// Valid JSON, but 2MB > the 1MB cap.
	big := `{"k":"` + strings.Repeat("x", 2<<20) + `"}`
	req := httptest.NewRequest(http.MethodPut, "/api/settings", strings.NewReader(big))
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != 413 {
		t.Fatalf("oversize PUT = %d, want 413", rec.Code)
	}
}

func TestUnknownAPIPath404(t *testing.T) {
	h := New([]string{t.TempDir()}, "")
	for _, target := range []string{"/api/nope", "/api/runs/x/discuss"} {
		res, _ := get(t, h, target)
		if res.StatusCode != 404 {
			t.Fatalf("GET %s = %d, want 404 (not implemented in Go backend)", target, res.StatusCode)
		}
	}
}

func TestStaticServedAndFallback(t *testing.T) {
	staticDir := t.TempDir()
	if err := os.WriteFile(filepath.Join(staticDir, "index.html"), []byte("<html>webui</html>"), 0o644); err != nil {
		t.Fatal(err)
	}
	h := New([]string{t.TempDir()}, staticDir)

	req := httptest.NewRequest(http.MethodGet, "/", nil)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != 200 || rec.Body.String() != "<html>webui</html>" {
		t.Fatalf("GET / = %d %q", rec.Code, rec.Body.String())
	}

	req = httptest.NewRequest(http.MethodGet, "/runs/abc", nil)
	rec = httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != 200 || rec.Body.String() != "<html>webui</html>" {
		t.Fatalf("SPA fallback = %d %q", rec.Code, rec.Body.String())
	}

	// API paths never fall through to static.
	if res, _ := get(t, h, "/api/nope"); res.StatusCode != 404 {
		t.Fatalf("api 404 = %d", res.StatusCode)
	}
}

func TestNoStaticDirAPIOnly(t *testing.T) {
	h := New([]string{t.TempDir()}, "")
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != 404 {
		t.Fatalf("GET / without static = %d, want 404", rec.Code)
	}
}
