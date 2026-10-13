package api

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"syscall"
	"testing"
	"time"

	"web-server/internal/runs"
)

func doRequest(t *testing.T, h http.Handler, method, target, body string) (int, []byte) {
	t.Helper()
	req := httptest.NewRequest(method, target, strings.NewReader(body))
	if body != "" {
		req.Header.Set("Content-Type", "application/json")
	}
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	return rec.Code, rec.Body.Bytes()
}

func seedRunFile(t *testing.T, dir, content string) {
	t.Helper()
	if err := os.WriteFile(filepath.Join(dir, "runs.jsonl"), []byte(content+"\n"), 0o644); err != nil {
		t.Fatal(err)
	}
}

// TestPostRunsValidation mirrors the original server's POST /api/runs checks.
func TestPostRunsValidation(t *testing.T) {
	dir := t.TempDir()
	s := newServer([]string{dir}, "")

	cases := []struct {
		name       string
		body       string
		wantStatus int
	}{
		{"empty prompt", `{"prompt":""}`, 400},
		{"missing prompt", `{"agent":"mock"}`, 400},
		{"agent not a string", `{"prompt":"x","agent":3}`, 400},
		{"bad tier", `{"prompt":"x","tier":5}`, 400},
		{"tier zero", `{"prompt":"x","tier":0}`, 400},
		{"cwd not a string", `{"prompt":"x","cwd":3}`, 400},
		{"valid full", `{"prompt":"fix the bug","agent":"mock","tier":4}`, 202},
		{"valid minimal", `{"prompt":"fix the bug"}`, 202},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			status, _ := doRequest(t, s.Handler(), http.MethodPost, "/api/runs", tc.body)
			if status != tc.wantStatus {
				t.Fatalf("POST /api/runs %s = %d, want %d", tc.body, status, tc.wantStatus)
			}
		})
	}
}

// TestPostRunsSpawnArgs verifies the exact argv passed to the detached at
// CLI, mirroring buildAtArgs in web-server/internal/api.
func TestPostRunsSpawnArgs(t *testing.T) {
	dir := t.TempDir()
	s := newServer([]string{dir}, "")
	var spawned []string
	s.SpawnAt = func(args ...string) error {
		spawned = args
		return nil
	}

	status, body := doRequest(t, s.Handler(), http.MethodPost, "/api/runs", `{"prompt":"fix the bug","agent":"mock","tier":4}`)
	if status != http.StatusAccepted {
		t.Fatalf("status = %d, want 202 (%s)", status, body)
	}
	want := []string{"-p", "fix the bug", "-a", "mock", "-t", "4"}
	if fmt.Sprint(spawned) != fmt.Sprint(want) {
		t.Fatalf("spawn args = %v, want %v", spawned, want)
	}

	// Minimal body spawns without -a/-t.
	spawned = nil
	doRequest(t, s.Handler(), http.MethodPost, "/api/runs", `{"prompt":"only prompt"}`)
	if fmt.Sprint(spawned) != fmt.Sprint([]string{"-p", "only prompt"}) {
		t.Fatalf("minimal spawn args = %v", spawned)
	}
}

// TestRetryRun respawns the stored prompt/agent/tier.
func TestRetryRun(t *testing.T) {
	dir := t.TempDir()
	seedRunFile(t, dir, `{"runId":"r1","agent":"mock","tier":4,"pid":999999,"prompt":"do it","logFile":"/tmp/x.log","startedAt":"2026-10-11T09:00:00.000Z","finishedAt":null,"exitCode":null,"status":"failed","name":"unnamed"}`)
	s := newServer([]string{dir}, "")
	var spawned []string
	s.SpawnAt = func(args ...string) error {
		spawned = args
		return nil
	}

	status, _ := doRequest(t, s.Handler(), http.MethodPost, "/api/runs/r1/retry", "")
	if status != http.StatusAccepted {
		t.Fatalf("retry status = %d, want 202", status)
	}
	want := []string{"-p", "do it", "-a", "mock", "-t", "4"}
	if fmt.Sprint(spawned) != fmt.Sprint(want) {
		t.Fatalf("retry spawn args = %v, want %v", spawned, want)
	}

	if status, _ := doRequest(t, s.Handler(), http.MethodPost, "/api/runs/nope/retry", ""); status != http.StatusNotFound {
		t.Fatalf("retry unknown = %d, want 404", status)
	}
}

func startSleep(t *testing.T) *exec.Cmd {
	t.Helper()
	child := exec.Command("sleep", "30")
	child.SysProcAttr = &syscall.SysProcAttr{Setsid: true}
	if err := child.Start(); err != nil {
		t.Skipf("cannot start sleep: %v", err)
	}
	t.Cleanup(func() { _ = child.Process.Kill() })
	return child
}

func waitDead(t *testing.T, child *exec.Cmd) {
	t.Helper()
	// Unlike Node's spawn, Go does not reap the child automatically: a killed
	// process lingers as a zombie and Signal(0) keeps succeeding. Wait()
	// reaps it (the DELETE already signalled the group, so this returns fast).
	waitErr := make(chan error, 1)
	go func() { waitErr <- child.Wait() }()
	select {
	case <-waitErr:
	case <-time.After(2 * time.Second):
		t.Fatal("sleep process still alive after DELETE")
	}
}

// TestDeleteRunKillsGroupAndMarksFailed spawns a real sleep process and
// verifies DELETE takes it down and persists status=failed.
func TestDeleteRunKillsGroupAndMarksFailed(t *testing.T) {
	dir := t.TempDir()
	s := newServer([]string{dir}, "")
	child := startSleep(t)

	seedRunFile(t, dir, fmt.Sprintf(`{"runId":"r1","agent":"mock","tier":4,"pid":%d,"prompt":"p","logFile":"/tmp/x.log","startedAt":"2026-10-11T09:00:00.000Z","finishedAt":null,"exitCode":null,"status":"running","name":"unnamed"}`, child.Process.Pid))

	status, body := doRequest(t, s.Handler(), http.MethodDelete, "/api/runs/r1", "")
	if status != http.StatusOK {
		t.Fatalf("delete status = %d, want 200 (%s)", status, body)
	}
	waitDead(t, child)

	stored := runs.LoadRuns(dir)
	if len(stored) != 1 || stored[0].Status != "failed" || stored[0].FinishedAt == nil {
		t.Fatalf("stored run not marked failed: %+v", stored)
	}
}

// TestDeleteRunForceSigkill is the ?force=1 variant.
func TestDeleteRunForceSigkill(t *testing.T) {
	dir := t.TempDir()
	s := newServer([]string{dir}, "")
	child := startSleep(t)

	seedRunFile(t, dir, fmt.Sprintf(`{"runId":"r1","agent":"mock","tier":4,"pid":%d,"prompt":"p","logFile":"/tmp/x.log","startedAt":"2026-10-11T09:00:00.000Z","finishedAt":null,"exitCode":null,"status":"running","name":"unnamed"}`, child.Process.Pid))

	status, _ := doRequest(t, s.Handler(), http.MethodDelete, "/api/runs/r1?force=1", "")
	if status != http.StatusOK {
		t.Fatalf("force delete status = %d, want 200", status)
	}
	waitDead(t, child)
	if stored := runs.LoadRuns(dir); len(stored) != 1 || stored[0].Status != "failed" {
		t.Fatalf("stored run not marked failed: %+v", stored)
	}
}

// TestDeleteRunDeadPidIsIdempotent: no live process, still marks failed, 200.
func TestDeleteRunDeadPidIsIdempotent(t *testing.T) {
	dir := t.TempDir()
	seedRunFile(t, dir, runJSON("r1", iso(0), "running", 999999))
	s := newServer([]string{dir}, "")

	status, body := doRequest(t, s.Handler(), http.MethodDelete, "/api/runs/r1", "")
	if status != http.StatusOK {
		t.Fatalf("delete dead-pid status = %d, want 200 (%s)", status, body)
	}
	stored := runs.LoadRuns(dir)
	if stored[0].Status != "failed" || stored[0].FinishedAt == nil {
		t.Fatalf("dead-pid run not marked failed: %+v", stored[0])
	}

	if status, _ := doRequest(t, s.Handler(), http.MethodDelete, "/api/runs/nope", ""); status != http.StatusNotFound {
		t.Fatalf("delete unknown = %d, want 404", status)
	}
}

// TestGetAgentsUsesAtBinAndCaches: agents come from `at agents --json`,
// cached for ~5s.
func TestGetAgentsUsesAtBinAndCaches(t *testing.T) {
	dir := t.TempDir()
	s := newServer([]string{dir}, "")

	calls := 0
	s.RunAt = func(_ context.Context, args ...string) (string, error) {
		calls++
		if fmt.Sprint(args) != "[agents --json]" {
			t.Fatalf("RunAt args = %v, want [agents --json]", args)
		}
		return `[{"name":"mock","tier":4,"deactivated":false,"failures":0,"lastFailure":null,"disabledTo":null}]`, nil
	}

	status, body := doRequest(t, s.Handler(), http.MethodGet, "/api/agents", "")
	if status != http.StatusOK {
		t.Fatalf("agents status = %d, want 200", status)
	}
	var agents []map[string]any
	if err := json.Unmarshal(body, &agents); err != nil {
		t.Fatalf("agents body is not JSON: %v (%s)", err, body)
	}
	if len(agents) != 1 || agents[0]["name"] != "mock" {
		t.Fatalf("unexpected agents payload: %s", body)
	}

	doRequest(t, s.Handler(), http.MethodGet, "/api/agents", "")
	if calls != 1 {
		t.Fatalf("agents cache not hit: RunAt called %d times", calls)
	}
}

// TestGetAgentsCommandFailureIs502.
func TestGetAgentsCommandFailureIs502(t *testing.T) {
	dir := t.TempDir()
	s := newServer([]string{dir}, "")
	s.RunAt = func(_ context.Context, _ ...string) (string, error) {
		return "", errors.New("exit status 1")
	}
	status, _ := doRequest(t, s.Handler(), http.MethodGet, "/api/agents", "")
	if status != http.StatusBadGateway {
		t.Fatalf("agents failure status = %d, want 502", status)
	}
}

// TestPutAgentEnableDisable delegates to `at enable|disable` and invalidates
// the agents cache.
func TestPutAgentEnableDisable(t *testing.T) {
	dir := t.TempDir()
	s := newServer([]string{dir}, "")

	var calls [][]string
	s.RunAt = func(_ context.Context, args ...string) (string, error) {
		calls = append(calls, args)
		switch fmt.Sprint(args) {
		case "[agents --json]":
			return `[]`, nil
		case "[disable mock]", "[enable mock]":
			return "", nil
		default:
			return "", fmt.Errorf("unexpected args %v", args)
		}
	}

	status, _ := doRequest(t, s.Handler(), http.MethodPut, "/api/agents/mock/disable", "")
	if status != http.StatusAccepted {
		t.Fatalf("disable status = %d, want 202", status)
	}
	status, _ = doRequest(t, s.Handler(), http.MethodPut, "/api/agents/mock/enable", "")
	if status != http.StatusAccepted {
		t.Fatalf("enable status = %d, want 202", status)
	}

	want := [][]string{{"disable", "mock"}, {"enable", "mock"}}
	if fmt.Sprint(calls[:2]) != fmt.Sprint(want) {
		t.Fatalf("delegation calls = %v, want %v", calls[:2], want)
	}

	// Cache must be invalidated by each PUT: the next GET re-invokes the CLI.
	doRequest(t, s.Handler(), http.MethodGet, "/api/agents", "")
	if len(calls) != 3 || fmt.Sprint(calls[2]) != "[agents --json]" {
		t.Fatalf("cache not invalidated after PUT: calls = %v", calls)
	}

	// Unknown builtin agent: 404 without delegating.
	if status, _ := doRequest(t, s.Handler(), http.MethodPut, "/api/agents/nope/disable", ""); status != http.StatusNotFound {
		t.Fatalf("disable unknown = %d, want 404", status)
	}

	// CLI failure maps to 400.
	s.RunAt = func(_ context.Context, args ...string) (string, error) {
		if fmt.Sprint(args) == "[agents --json]" {
			return `[]`, nil
		}
		return "", fmt.Errorf("exit status 1")
	}
	if status, _ := doRequest(t, s.Handler(), http.MethodPut, "/api/agents/mock/disable", ""); status != http.StatusBadRequest {
		t.Fatalf("disable CLI failure = %d, want 400", status)
	}
}
