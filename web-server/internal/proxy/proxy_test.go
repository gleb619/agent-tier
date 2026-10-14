package proxy

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
)

// makeFakeBridgeAt writes a shell shim that emulates the `at bridge`
// surface every proxy test path needs. Argv layout produced by the proxy
// (see internal/proxy/bridge.go Call):
//
//	at bridge <res> <verb> [id]
//
// Inside the shim: $1 = "bridge", $2 = resource, $3 = verb, $4 = id.
//
//	agents list                    → canned agents payload
//	runs  list                     → canned runs payload
//	runs  get                      → echo id + canned prompt/agent/tier
//	runs  stop                     → { runId, pid, signal, alive, stopped }
//	discuss list                   → canned discuss thread
//	discuss say|answer             → { id: "m2" }
//	events tail                    → canned array
//	ping ping                      → { version: "test-9.9.9" }
//	health get                     → canned scheduler state block
//	anything else                  → usage envelope + exit 2
func makeFakeBridgeAt(t *testing.T, dir string) string {
	t.Helper()
	shim := filepath.Join(dir, "at")
	body := `#!/bin/sh
set -eu
# consume stdin silently
cat >/dev/null
res="$2"
verb="$3"
case "$res:$verb" in
  agents:list)
    printf '{"ok":true,"data":[{"tier":4,"name":"mock","deactivated":false,"failures":0,"lastFailure":null,"disabledTo":null}]}'
    ;;
  runs:list)
    printf '{"ok":true,"data":[]}'
    ;;
  runs:get)
    printf '{"ok":true,"data":{"runId":"%s","agent":"mock","tier":4,"prompt":"hello","logFile":"/tmp/x.log","startedAt":"2026-10-14T09:00:00.000Z","finishedAt":null,"exitCode":null,"status":"running","name":"u"}}' "${4:-}"
    ;;
  runs:stop)
    printf '{"ok":true,"data":{"runId":"%s","pid":99999,"signal":"SIGTERM","alive":false,"stopped":true}}' "${4:-}"
    ;;
  discuss:list)
    printf '{"ok":true,"data":[{"id":"m1","from":"agent","kind":"question","text":"which port?","ts":"2026-10-14T09:00:00.000Z"}]}'
    ;;
  discuss:say|discuss:answer)
    printf '{"ok":true,"data":{"id":"m2"}}'
    ;;
  events:tail)
    printf '{"ok":true,"data":[{"runId":"x","agent":"mock","ts":"2026-10-14T09:00:00.000Z","seq":1,"type":"start"},{"runId":"x","agent":"mock","ts":"2026-10-14T09:00:01.000Z","seq":2,"type":"message","text":"hi"}]}'
    ;;
  ping:ping)
    printf '{"ok":true,"data":{"version":"test-9.9.9"}}'
    ;;
  health:get)
    printf '{"ok":true,"data":{"scheduler":"round-robin","maxEntries":24,"agents":[]}}'
    ;;
  *)
    printf '{"error":{"code":"USAGE","message":"unknown verb %s"}}' "$verb"
    exit 2 ;;
esac
`
	if err := os.WriteFile(shim, []byte(body), 0o755); err != nil {
		t.Fatalf("write shim: %v", err)
	}
	return shim
}

func TestCallSuccessEnvelope(t *testing.T) {
	dir := t.TempDir()
	shim := makeFakeBridgeAt(t, dir)

	res := Call(context.Background(), shim, "agents", "list", "", nil)
	if res.Err != nil {
		t.Fatalf("Call error: %v", res.Err)
	}
	var payload []map[string]any
	if err := json.Unmarshal(res.Data, &payload); err != nil {
		t.Fatalf("data unmarshal: %v (raw %s)", err, res.Data)
	}
	if len(payload) != 1 || payload[0]["name"] != "mock" {
		t.Fatalf("payload = %v", payload)
	}
}

func TestCallErrorEnvelopeMapsHTTPStatus(t *testing.T) {
	shim := makeFakeBridgeAt(t, t.TempDir())
	res := Call(context.Background(), shim, "nope", "nada", "", nil)
	if res.Err == nil {
		t.Fatalf("expected error envelope")
	}
	if res.Code != "USAGE" {
		t.Fatalf("code = %q, want USAGE", res.Code)
	}
	if got := HTTPStatus(res.Code); got != http.StatusBadRequest {
		t.Fatalf("HTTPStatus = %d, want 400", got)
	}
}

func TestCallMergesIdPositional(t *testing.T) {
	dir := t.TempDir()
	// Custom shim that records stdin instead of responding.
	shim := filepath.Join(dir, "at")
	body := `#!/bin/sh
cat >/dev/null
printf '{"ok":true,"data":[]}'
`
	if err := os.WriteFile(shim, []byte(body), 0o755); err != nil {
		t.Fatalf("write shim: %v", err)
	}
	res := Call(context.Background(), shim, "runs", "get", "abc123", nil)
	if res.Err != nil {
		t.Fatalf("Call error: %v", res.Err)
	}
	if string(res.Data) != "[]" {
		t.Fatalf("data = %s, want []", res.Data)
	}
}

func TestServerDispatchBridgePass(t *testing.T) {
	shim := makeFakeBridgeAt(t, t.TempDir())
	srv := &Server{AtBin: shim, SpawnAt: func(...string) error { return nil }}

	res := doGET(srv, "/api/agents")
	if res.code != 200 {
		t.Fatalf("status = %d", res.code)
	}
	if !strings.Contains(res.body, `"mock"`) {
		t.Fatalf("body missing mock: %s", res.body)
	}
}

func TestServerDispatchStats(t *testing.T) {
	shim := makeFakeBridgeAt(t, t.TempDir())
	srv := &Server{AtBin: shim, SpawnAt: func(...string) error { return nil }}

	res := doGET(srv, "/api/stats")
	if res.code != 200 {
		t.Fatalf("status = %d (body %s)", res.code, res.body)
	}
	var stats map[string]any
	if err := json.Unmarshal([]byte(res.body), &stats); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if _, ok := stats["agents"]; !ok {
		t.Fatalf("missing agents block: %v", stats)
	}
	if total, _ := stats["total"].(float64); total != 0 {
		t.Fatalf("total = %v, want 0", stats["total"])
	}
}

func TestServerDispatchSSE(t *testing.T) {
	shim := makeFakeBridgeAt(t, t.TempDir())
	srv := &Server{AtBin: shim, SpawnAt: func(...string) error { return nil }}

	res := doGET(srv, "/api/events")
	if res.code != 200 {
		t.Fatalf("status = %d", res.code)
	}
	if !strings.Contains(res.body, "data: ") {
		t.Fatalf("body missing SSE frames: %s", res.body)
	}
	if strings.Count(res.body, "data: ") != 2 {
		t.Fatalf("want 2 SSE frames, got body %s", res.body)
	}
}

func TestServerDispatchCreateRunValidation(t *testing.T) {
	var spawned int32
	srv := &Server{AtBin: "true", SpawnAt: func(args ...string) error {
		atomic.AddInt32(&spawned, 1)
		return nil
	}}

	cases := []struct {
		body string
		want int
	}{
		{`{}`, 400},
		{`{"prompt":""}`, 400},
		{`{"prompt":"hi","tier":5}`, 400},
		{`{"prompt":"hi","agent":3}`, 400},
		{`{"prompt":"hi"}`, 202},
		{`{"prompt":"hi","tier":2,"agent":"mock","cwd":"/tmp"}`, 202},
	}
	for _, c := range cases {
		res := postJSON(srv, "/api/runs", c.body)
		if res.code != c.want {
			t.Fatalf("body %s → status %d, want %d (%s)", c.body, res.code, c.want, res.body)
		}
	}
	if atomic.LoadInt32(&spawned) != 2 {
		t.Fatalf("SpawnAt calls = %d, want 2", spawned)
	}
}

func TestServerDispatchDeleteRunProxiesBridge(t *testing.T) {
	shim := makeFakeBridgeAt(t, t.TempDir())
	srv := &Server{AtBin: shim, SpawnAt: func(...string) error { return nil }}

	res := doDelete(srv, "/api/runs/run-abc")
	if res.code != 200 {
		t.Fatalf("status = %d (body %s)", res.code, res.body)
	}
	if !strings.Contains(res.body, `"stopped":true`) {
		t.Fatalf("missing stopped flag: %s", res.body)
	}
}

func TestServerDispatchSettingsRoundtrip(t *testing.T) {
	tmp := t.TempDir()
	t.Setenv("AT_STATE_DIR", tmp)
	srv := &Server{AtBin: "true", SpawnAt: func(...string) error { return nil }}

	get := doGET(srv, "/api/settings")
	if get.code != 200 {
		t.Fatalf("get status = %d", get.code)
	}
	if strings.TrimSpace(get.body) != "{}" {
		t.Fatalf("default settings = %s, want {}", get.body)
	}

	put := putJSON(srv, "/api/settings", `{"defaultTier":2,"retries":3}`)
	if put.code != 200 {
		t.Fatalf("put status = %d (%s)", put.code, put.body)
	}
	get2 := doGET(srv, "/api/settings")
	if !strings.Contains(get2.body, `"defaultTier"`) {
		t.Fatalf("settings not persisted: %s", get2.body)
	}
}

func TestServerDispatchDiscussPost(t *testing.T) {
	shim := makeFakeBridgeAt(t, t.TempDir())
	srv := &Server{AtBin: shim, SpawnAt: func(...string) error { return nil }}

	res := postJSON(srv, "/api/runs/r1/discuss", `{"kind":"say","text":"hi"}`)
	if res.code != 202 {
		t.Fatalf("status = %d (%s)", res.code, res.body)
	}
	if !strings.Contains(res.body, `"id"`) {
		t.Fatalf("missing id: %s", res.body)
	}
}

func TestServerDispatchPing(t *testing.T) {
	shim := makeFakeBridgeAt(t, t.TempDir())
	srv := &Server{AtBin: shim, SpawnAt: func(...string) error { return nil }}
	res := doGET(srv, "/api/ping")
	if res.code != 200 {
		t.Fatalf("status = %d (%s)", res.code, res.body)
	}
	if !strings.Contains(res.body, `"version"`) {
		t.Fatalf("missing version: %s", res.body)
	}
}

// --- tiny in-process http helpers -----------------------------------------

type resp struct {
	code int
	body string
}

func TestCallStubBinaryViaPathAssertsArgsStdinAndEnvelope(t *testing.T) {
	dir := t.TempDir()
	stub := filepath.Join(dir, "at")
	recordFile := filepath.Join(dir, "record.json")
	body := `#!/bin/sh
set -eu
echo "ARGS:$@" > ` + recordFile + `
echo "STDIN:$(cat)" >> ` + recordFile + `
printf '{"ok":true,"data":{"recorded":"yes"}}'
`
	if err := os.WriteFile(stub, []byte(body), 0o755); err != nil {
		t.Fatalf("write stub: %v", err)
	}
	t.Setenv("PATH", dir+":"+os.Getenv("PATH"))

	res := Call(context.Background(), "at", "events", "tail", "run-1", map[string]any{"since": 1, "limit": 10})
	if res.Err != nil {
		t.Fatalf("Call error with stub binary: %v (raw: %s, stderr: %s)", res.Err, res.Data, res.Message)
	}
	if res.Code != "" {
		t.Fatalf("expected no error code, got %q", res.Code)
	}
	if string(res.Data) != `{"recorded":"yes"}` {
		t.Fatalf("unexpected data: %s", string(res.Data))
	}
	recordRaw, err := os.ReadFile(recordFile)
	if err != nil {
		t.Fatalf("read record file: %v", err)
	}
	recordStr := string(recordRaw)
	if !strings.Contains(recordStr, "ARGS:bridge events tail") {
		t.Fatalf("stub args missing expected argv: %s", recordStr)
	}
	if !strings.Contains(recordStr, `"since":1`) {
		t.Fatalf("stub stdin missing params: %s", recordStr)
	}
}

func TestCallStubBinaryErrorEnvelopeMapsToCodeAndStatus(t *testing.T) {
	dir := t.TempDir()
	stub := filepath.Join(dir, "at")
	body := `#!/bin/sh
printf '{"error":{"code":"USAGE","message":"bad args"}}'
exit 2
`
	if err := os.WriteFile(stub, []byte(body), 0o755); err != nil {
		t.Fatalf("write stub: %v", err)
	}
	t.Setenv("PATH", dir+":"+os.Getenv("PATH"))

	res := Call(context.Background(), "at", "bad", "verb", "", nil)
	if res.Err == nil {
		t.Fatalf("expected error envelope from stub")
	}
	if res.Code != "USAGE" {
		t.Fatalf("code = %q, want USAGE", res.Code)
	}
	if res.Message != "bad args" {
		t.Fatalf("message = %q, want 'bad args'", res.Message)
	}
	if HTTPStatus(res.Code) != 400 {
		t.Fatalf("HTTPStatus(USAGE) = %d, want 400", HTTPStatus(res.Code))
	}
}

func doGET(srv *Server, path string) resp {
	req := httptest.NewRequest(http.MethodGet, path, nil)
	rec := httptest.NewRecorder()
	srv.Handler().ServeHTTP(rec, req)
	return resp{rec.Code, rec.Body.String()}
}

func doDelete(srv *Server, path string) resp {
	req := httptest.NewRequest(http.MethodDelete, path, nil)
	rec := httptest.NewRecorder()
	srv.Handler().ServeHTTP(rec, req)
	return resp{rec.Code, rec.Body.String()}
}

func postJSON(srv *Server, path, body string) resp {
	req := httptest.NewRequest(http.MethodPost, path, strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	srv.Handler().ServeHTTP(rec, req)
	return resp{rec.Code, rec.Body.String()}
}

func putJSON(srv *Server, path, body string) resp {
	req := httptest.NewRequest(http.MethodPut, path, strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	srv.Handler().ServeHTTP(rec, req)
	return resp{rec.Code, rec.Body.String()}
}

// ensure io is referenced (the file uses it elsewhere).
var _ = io.EOF
