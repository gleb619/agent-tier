package proxy

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"strings"
	"sync"

	"web-server/internal/static"
)

// Server is the thin HTTP backend. It owns:
//   - the `at` binary used for bridge calls + detached run spawning
//   - the static dir for SPA fallback
//   - the SSE writer shim (one shot today: replay via `at bridge events tail`)
type Server struct {
	StaticDir string
	AtBin     string
	BaseURL   string

	// SpawnAt spawns a detached `at` run (fire-and-forget). Used for the
	// two REST endpoints that have no `at bridge` verb yet:
	//   POST /api/runs              — create a run
	//   POST /api/runs/:id/retry    — respawn with stored prompt/agent/tier
	SpawnAt func(args ...string) error
	// RunAt runs `at` synchronously and returns stdout (used for
	// enable|disable — the bridge has no verb yet, but the response is
	// only valid once the toggle has been persisted).
	RunAt func(ctx context.Context, args ...string) (string, error)

	// agentsCache caches `at bridge agents list` for stats/governance paths
	// (re-evaluated by the next call; no TTL by design — the bridge is
	// already fast and authoritative).
	agentsMu    sync.Mutex
	agentsCache []map[string]any
}

// New builds a Server. The at binary defaults to the AT_BIN env or `at`.
func New(staticDir string) *Server {
	atBin := os.Getenv("AT_BIN")
	if atBin == "" {
		atBin = "at"
	}
	return &Server{
		StaticDir: staticDir,
		AtBin:     atBin,
		SpawnAt: func(args ...string) error {
			return defaultSpawnAt(atBin, args...)
		},
		RunAt: func(ctx context.Context, args ...string) (string, error) {
			return defaultRunAt(ctx, atBin, args...)
		},
	}
}

// SetBaseURL pins the public URL for any URL we need to send back. Reserved
// for the daemon rewrite (T33); unused today.
func (s *Server) SetBaseURL(u string) { s.BaseURL = u }

// Handler returns the http.Handler. /api/* routes + /events (SSE replay) +
// the static SPA fallback.
func (s *Server) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("/api/", s.dispatchAPI)
	mux.HandleFunc("/events", s.handleSSE)
	mux.HandleFunc("/events/", s.handleSSE)
	if s.StaticDir != "" {
		mux.Handle("/", static.Handler(s.StaticDir))
	} else {
		mux.HandleFunc("/", notFound)
	}
	return mux
}

func notFound(w http.ResponseWriter, _ *http.Request) {
	jsonError(w, http.StatusNotFound, "not found")
}

// dispatchAPI routes every /api/* request to either:
//   - an `at bridge <res> <verb>` call (preferred path — see bridge.go), or
//   - a direct `at` exec for the legacy endpoints that have no bridge verb
//     yet (POST /api/runs, /api/runs/:id/retry, GET /api/runs/:id/log,
//     PUT /api/agents/:name/{enable,disable}).
//
// Anything outside the route table returns 404 — the thin proxy never tries
// to reinvent bridge semantics in Go.
func (s *Server) dispatchAPI(w http.ResponseWriter, r *http.Request) {
	rest := strings.TrimPrefix(r.URL.Path, "/api")
	parts := splitPath(strings.Trim(rest, "/"))
	if len(parts) == 0 || parts[0] == "" {
		notFound(w, r)
		return
	}
	switch {
	// --- runs --------------------------------------------------------
	case parts[0] == "runs" && r.Method == http.MethodGet && len(parts) == 1:
		s.bridgePass(w, r, "runs", "list", "")

	case parts[0] == "runs" && r.Method == http.MethodPost && len(parts) == 1:
		s.handleCreateRun(w, r)

	case parts[0] == "runs" && r.Method == http.MethodGet && len(parts) == 2:
		s.bridgePass(w, r, "runs", "get", parts[1])

	case parts[0] == "runs" && r.Method == http.MethodDelete && len(parts) == 2:
		s.handleDeleteRun(w, r, parts[1])

	case parts[0] == "runs" && r.Method == http.MethodPost && len(parts) == 3 && parts[2] == "retry":
		s.handleRetryRun(w, r, parts[1])

	case parts[0] == "runs" && r.Method == http.MethodGet && len(parts) == 3 && parts[2] == "log":
		s.handleRunLog(w, r, parts[1])

	case parts[0] == "runs" && (r.Method == http.MethodGet || r.Method == http.MethodPost) && len(parts) == 3 && parts[2] == "discuss":
		s.handleDiscuss(w, r, parts[1])

	case parts[0] == "runs" && r.Method == http.MethodPost && len(parts) == 3 && parts[2] == "discuss":
		s.handleDiscuss(w, r, parts[1])

	// --- events (SSE) ------------------------------------------------
	case parts[0] == "events" && r.Method == http.MethodGet && len(parts) == 1:
		s.sseFromAPI(w, r, "")

	case parts[0] == "events" && r.Method == http.MethodGet && len(parts) == 2:
		s.sseFromAPI(w, r, parts[1])

	// --- agents ------------------------------------------------------
	case parts[0] == "agents" && r.Method == http.MethodGet && len(parts) == 1:
		s.bridgePass(w, r, "agents", "list", "")

	case parts[0] == "agents" && r.Method == http.MethodPut && len(parts) == 3 && (parts[2] == "enable" || parts[2] == "disable"):
		s.handleAgentToggle(w, r, parts[1], parts[2])

	// --- stats -------------------------------------------------------
	case parts[0] == "stats" && r.Method == http.MethodGet && len(parts) == 1:
		s.handleStats(w, r)

	// --- settings ----------------------------------------------------
	case parts[0] == "settings" && r.Method == http.MethodGet && len(parts) == 1:
		// Settings live in their own file (no `at bridge settings` verb yet).
		// Read directly from the first joined state dir.
		s.handleSettingsGet(w, r)

	case parts[0] == "settings" && r.Method == http.MethodPut && len(parts) == 1:
		s.handleSettingsPut(w, r)

	// --- bridge ping/health proxies (handy for the WebUI + future daemon) ---
	case parts[0] == "ping" && r.Method == http.MethodGet && len(parts) == 1:
		s.bridgePass(w, r, "ping", "ping", "")

	case parts[0] == "health" && r.Method == http.MethodGet && len(parts) == 1:
		s.bridgePass(w, r, "health", "get", "")

	default:
		notFound(w, r)
	}
}

// splitPath splits a path on '/' and drops empty segments.
func splitPath(s string) []string {
	if s == "" {
		return nil
	}
	out := strings.Split(s, "/")
	clean := out[:0]
	for _, p := range out {
		if p != "" {
			clean = append(clean, p)
		}
	}
	return clean
}

// jsonError / writeJSON are tiny helpers; the proxy has no other use for json.
func jsonError(w http.ResponseWriter, status int, msg string) {
	writeJSON(w, status, map[string]string{"error": msg})
}

func writeJSON(w http.ResponseWriter, status int, payload any) {
	buf, err := json.Marshal(payload)
	if err != nil {
		http.Error(w, `{"error":"internal marshal failure"}`, http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_, _ = w.Write(buf)
}

// bridgePass forwards a request to `at bridge <res> <verb>` with the same
// `id` (path segment) and stdin params. On success the data is written
// directly; on bridge error the matching HTTP status and the machine code
// are returned.
func (s *Server) bridgePass(w http.ResponseWriter, r *http.Request, res, verb, id string) {
	params, parseErr := bodyToMap(r)
	if parseErr != nil {
		jsonError(w, http.StatusBadRequest, "invalid JSON body")
		return
	}
	q := r.URL.Query()
	for k := range q {
		if _, exists := params[k]; !exists {
			params[k] = q.Get(k)
		}
	}
	res2 := Call(r.Context(), s.AtBin, res, verb, id, params)
	if res2.Err != nil {
		// Distinguish parse/timeout/exec failures from envelope errors.
		if res2.Code != "" {
			jsonError(w, HTTPStatus(res2.Code), res2.Message)
			return
		}
		jsonError(w, http.StatusBadGateway, res2.Err.Error())
		return
	}
	if len(res2.Data) == 0 || string(res2.Data) == "null" {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte("null"))
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(res2.Data)
}

// bodyToMap decodes a JSON request body into a map; empty/missing body returns
// an empty map. Anything except a JSON object → error (consistent with the
// bridge's "params must be an object" contract).
func bodyToMap(r *http.Request) (map[string]any, error) {
	if r.Body == nil {
		return map[string]any{}, nil
	}
	raw, err := io.ReadAll(r.Body)
	if err != nil {
		return nil, err
	}
	if len(raw) == 0 {
		return map[string]any{}, nil
	}
	var v any
	if err := json.Unmarshal(raw, &v); err != nil {
		return nil, err
	}
	obj, ok := v.(map[string]any)
	if !ok {
		return nil, fmt.Errorf("body must be a JSON object")
	}
	return obj, nil
}

// defaultSpawnAt starts `at` detached for a new run. Mirrors what the
// runner.ts CLI does for `-s` background mode; cmd-line parity is the
// WebUI's only contract here, and the bridge isn't the right shape for it
// (spawn is fire-and-forget, not request/response).
func defaultSpawnAt(atBin string, args ...string) error {
	cmd := exec.Command(atBin, args...)
	cmd.Stdin, cmd.Stdout, cmd.Stderr = nil, nil, nil
	return cmd.Start()
}

// defaultRunAt runs `at` synchronously and returns its stdout. The caller
// is responsible for cancel-via-context; the helper only surfaces the
// underlying exit error.
func defaultRunAt(ctx context.Context, atBin string, args ...string) (string, error) {
	cmd := exec.CommandContext(ctx, atBin, args...)
	var stdout bytes.Buffer
	cmd.Stdout = &stdout
	var stderr bytes.Buffer
	cmd.Stderr = &stderr
	cmd.Stdin = nil
	if err := cmd.Run(); err != nil {
		// Keep stderr in the error: callers match on it (e.g. "Unknown agent").
		if msg := strings.TrimSpace(stderr.String()); msg != "" {
			return "", fmt.Errorf("%w: %s", err, msg)
		}
		return "", err
	}
	return stdout.String(), nil
}

// _ ensures the strconv import stays meaningful if future handlers need it
// (originally referenced for ?lines=N parsing on /runs/:id/log — moved to
// handlers.go where the log-tail lives).
var _ = strings.HasPrefix
