// Package api exposes the WebUI HTTP surface, byte-compatible with the Node
// server (src/web/server.ts): /api/runs (GET/POST), /api/runs/:id
// (GET/DELETE), /api/runs/:id/retry, /api/runs/:id/log, /api/agents
// (GET + PUT enable/disable), /api/stats, GET/PUT /api/settings, plus static
// SPA serving. Mutations delegate to the `at` CLI (spawn for runs, `at
// agents --json`, `at enable|disable`) or write runs.jsonl under the TS lock
// protocol. The SSE/discuss proxy lands with the Go SSE task.
package api

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"

	"web-server/internal/events"
	"web-server/internal/runs"
	"web-server/internal/settings"
	"web-server/internal/static"
)

const (
	defaultLogTailLines = 200
	maxBodyBytes        = 1 << 20 // 1MB request body cap
)

// Server is the web backend. StateDirs are the joined state dirs (project
// `.at/` first, then `~/.at/`); StaticDir may be empty (API-only). AtBin is
// the `at` CLI used for delegated mutations (AT_BIN env override, else
// PATH). SpawnAt/RunAt are injectable seams for tests.
type Server struct {
	StateDirs []string
	StaticDir string
	AtBin     string
	BaseURL   string
	Hub       *events.Hub
	// SpawnAt launches a detached `at` run (fire-and-forget).
	SpawnAt func(args ...string) error
	// RunAt runs `at` synchronously and returns stdout.
	RunAt func(ctx context.Context, args ...string) (string, error)

	agentsMu       sync.Mutex
	agentsCache    []agentEntry
	agentsCachedAt time.Time
}

func newServer(stateDirs []string, staticDir string) *Server {
	atBin := os.Getenv("AT_BIN")
	if atBin == "" {
		atBin = "at"
	}
	var hub *events.Hub
	if len(stateDirs) > 0 {
		hub = events.NewHub(stateDirs[0])
	}
	return &Server{StateDirs: stateDirs, StaticDir: staticDir, AtBin: atBin, Hub: hub}
}

// SetBaseURL pins the public URL the server is reachable on (used for
// AT_SSE_URL when spawning runs).
func (s *Server) SetBaseURL(url string) {
	s.BaseURL = url
}

// NewServer returns a mutable Server for advanced wiring (e.g. setting
// BaseURL after the listener is known). New() is the simple handler wrapper.
func NewServer(stateDirs []string, staticDir string) *Server {
	return newServer(stateDirs, staticDir)
}

// Handler builds the HTTP handler serving this server: /api/* routes plus
// the static SPA fallback.
func (s *Server) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.Handle("/api/", http.HandlerFunc(s.handleAPI))
	s.mountHubRoutes(mux)
	if s.StaticDir != "" {
		mux.Handle("/", static.Handler(s.StaticDir))
	} else {
		mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
			jsonError(w, http.StatusNotFound, "not found")
		})
	}
	return mux
}

func (s *Server) mountHubRoutes(mux *http.ServeMux) {
	if s.Hub == nil {
		return
	}
	mux.HandleFunc("/events", s.hubEventsRoute)
	mux.HandleFunc("/events/", s.hubEventsRoute)
	mux.HandleFunc("/emit/", func(w http.ResponseWriter, r *http.Request) {
		s.Hub.HandleEmitRoute(w, r)
	})
	mux.HandleFunc("/discuss/", func(w http.ResponseWriter, r *http.Request) {
		id, ok := extractDiscussID(r.URL.Path)
		if !ok {
			jsonError(w, http.StatusNotFound, "not found")
			return
		}
		s.Hub.HandleDiscussRoute(w, r, id)
	})
}

func (s *Server) hubEventsRoute(w http.ResponseWriter, r *http.Request) {
	if s.Hub == nil {
		jsonError(w, http.StatusNotFound, "not found")
		return
	}
	s.Hub.HandleEventsRoute(w, r)
}

func extractDiscussID(path string) (string, bool) {
	rest := strings.TrimPrefix(path, "/discuss")
	rest = strings.TrimPrefix(rest, "/")
	if rest == "" {
		return "", false
	}
	id, err := url.PathUnescape(rest)
	if err != nil {
		return "", false
	}
	return id, true
}

// New builds the full HTTP handler: /api/* routes + static SPA fallback.
func New(stateDirs []string, staticDir string) http.Handler {
	return newServer(stateDirs, staticDir).Handler()
}

func jsonError(w http.ResponseWriter, status int, message string) {
	writeJSON(w, status, map[string]string{"error": message})
}

func writeJSON(w http.ResponseWriter, status int, data any) {
	out, err := json.Marshal(data)
	if err != nil {
		http.Error(w, `{"error":"marshal failure"}`, http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	w.Write(out) //nolint:errcheck // client gone mid-write is not actionable
}

// refreshRuns is the read-only equivalent of refreshRuns in src/run-store.ts:
// prune (TTL + maxEntries) then annotate, in memory only.
func (s *Server) refreshRuns(dir string) []runs.RunRecord {
	return runs.DetectStuck(runs.PruneList(runs.LoadRuns(dir), 24*time.Hour, runs.MaxRuns(dir)), runs.DetectOpts{
		Now:      time.Now,
		PidAlive: runs.PidAlive,
	})
}

func (s *Server) joinedRuns() []runs.ScopedRun {
	perDir := make([][]runs.RunRecord, len(s.StateDirs))
	for i, dir := range s.StateDirs {
		perDir[i] = s.refreshRuns(dir)
	}
	return runs.JoinRuns(s.StateDirs, perDir)
}

func (s *Server) handleAPI(w http.ResponseWriter, r *http.Request) {
	rest := strings.TrimPrefix(r.URL.Path, "/api")
	segments := strings.Split(strings.Trim(rest, "/"), "/")

	switch {
	case len(segments) == 1 && segments[0] == "runs" && r.Method == http.MethodGet:
		writeJSON(w, http.StatusOK, s.joinedRuns())
		return

	case len(segments) == 1 && segments[0] == "runs" && r.Method == http.MethodPost:
		s.handleCreateRun(w, r)
		return

	case len(segments) == 2 && segments[0] == "runs" && r.Method == http.MethodGet:
		id, err := urlUnescape(segments[1])
		if err != nil {
			jsonError(w, http.StatusBadRequest, "bad run id")
			return
		}
		run, _, ok := runs.FindRun(s.StateDirs, id)
		if !ok {
			jsonError(w, http.StatusNotFound, "run not found")
			return
		}
		writeJSON(w, http.StatusOK, run)
		return

	case len(segments) == 2 && segments[0] == "runs" && r.Method == http.MethodDelete:
		s.handleDeleteRun(w, r, segments[1])
		return

	case len(segments) == 3 && segments[0] == "runs" && segments[2] == "retry" && r.Method == http.MethodPost:
		s.handleRetry(w, r, segments[1])
		return

	case len(segments) == 3 && segments[0] == "runs" && segments[2] == "log" && r.Method == http.MethodGet:
		s.handleLog(w, r, segments[1])
		return

	// SSE proxy: /api/events (all runs) and /api/events/:runId (single run).
	case len(segments) >= 1 && segments[0] == "events" && r.Method == http.MethodGet:
		s.handleAPIEvents(w, r, segments)
		return

	// Discuss proxy: /api/runs/:id/discuss.
	case len(segments) == 3 && segments[0] == "runs" && segments[2] == "discuss":
		s.handleAPIDiscuss(w, r, segments[1])
		return

	case len(segments) == 1 && segments[0] == "agents" && r.Method == http.MethodGet:
		s.handleAgents(w, r)
		return

	case len(segments) == 3 && segments[0] == "agents" &&
		(segments[2] == "enable" || segments[2] == "disable") && r.Method == http.MethodPut:
		s.handleAgentAction(w, r, segments[1], segments[2])
		return

	case len(segments) == 1 && segments[0] == "stats" && r.Method == http.MethodGet:
		s.handleStats(w)
		return

	case len(segments) == 1 && segments[0] == "settings":
		if r.Method == http.MethodGet {
			writeJSON(w, http.StatusOK, settings.Load(settings.File(s.StateDirs, "")))
			return
		}
		if r.Method == http.MethodPut {
			s.handleSettingsPut(w, r)
			return
		}
	}

	jsonError(w, http.StatusNotFound, "not found")
}

func (s *Server) handleAPIEvents(w http.ResponseWriter, r *http.Request, segments []string) {
	if s.Hub == nil {
		jsonError(w, http.StatusNotFound, "not found")
		return
	}
	if len(segments) == 1 {
		s.Hub.ServeEvents(w, r, "")
		return
	}
	if len(segments) == 2 {
		runID, err := url.PathUnescape(segments[1])
		if err != nil {
			jsonError(w, http.StatusBadRequest, "bad run id")
			return
		}
		s.Hub.ServeEvents(w, r, runID)
		return
	}
	jsonError(w, http.StatusNotFound, "not found")
}

func (s *Server) handleAPIDiscuss(w http.ResponseWriter, r *http.Request, idSegment string) {
	runID, err := urlUnescape(idSegment)
	if err != nil {
		jsonError(w, http.StatusBadRequest, "bad run id")
		return
	}
	if _, _, ok := runs.FindRun(s.StateDirs, runID); !ok {
		jsonError(w, http.StatusNotFound, "run not found")
		return
	}
	if s.Hub == nil {
		jsonError(w, http.StatusNotFound, "not found")
		return
	}
	s.Hub.HandleDiscussRoute(w, r, runID)
}

func urlUnescape(s string) (string, error) {
	return url.PathUnescape(s)
}

func (s *Server) handleLog(w http.ResponseWriter, r *http.Request, idSegment string) {
	id, err := urlUnescape(idSegment)
	if err != nil {
		jsonError(w, http.StatusBadRequest, "bad run id")
		return
	}
	run, _, ok := runs.FindRun(s.StateDirs, id)
	if !ok {
		jsonError(w, http.StatusNotFound, "run not found")
		return
	}
	lines := defaultLogTailLines
	if raw := r.URL.Query().Get("lines"); raw != "" {
		if n, err := strconv.Atoi(raw); err == nil && n > 0 {
			lines = n
		}
	}
	out, err := runs.TailLines(run.LogFile, lines)
	if err != nil {
		jsonError(w, http.StatusNotFound, "log file not found")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"runId": run.RunID, "lines": out})
}

// deactivatedAgents counts agents marked deactivated in any joined state
// dir's state.json health block (earlier dir wins per name, like the Node
// /api/stats handler).
func (s *Server) deactivatedAgents() int {
	deactivated := make(map[string]bool)
	for _, dir := range s.StateDirs {
		raw, err := os.ReadFile(filepath.Join(dir, "state.json"))
		if err != nil {
			continue
		}
		var state struct {
			Agents map[string]struct {
				Deactivated bool `json:"deactivated"`
			} `json:"agents"`
		}
		if json.Unmarshal(raw, &state) != nil {
			continue
		}
		for name, h := range state.Agents {
			if h.Deactivated {
				deactivated[name] = true
			}
		}
	}
	return len(deactivated)
}

func (s *Server) handleStats(w http.ResponseWriter) {
	joined := s.joinedRuns()
	stats := map[string]any{
		"total":   len(joined),
		"running": 0,
		"done":    0,
		"failed":  0,
		"stuck":   0,
		"agents": map[string]any{
			"total":       len(builtinAgents) + countGenericAgents(),
			"deactivated": s.deactivatedAgents(),
		},
	}
	for _, r := range joined {
		switch r.Status {
		case "running", "done", "failed", "stuck":
			stats[r.Status] = stats[r.Status].(int) + 1
		}
	}
	writeJSON(w, http.StatusOK, stats)
}

func (s *Server) handleSettingsPut(w http.ResponseWriter, r *http.Request) {
	r.Body = http.MaxBytesReader(w, r.Body, maxBodyBytes)
	var parsed any
	if err := json.NewDecoder(r.Body).Decode(&parsed); err != nil {
		var tooLarge *http.MaxBytesError
		if errors.As(err, &tooLarge) {
			jsonError(w, http.StatusRequestEntityTooLarge, "request body too large")
			return
		}
		jsonError(w, http.StatusBadRequest, "invalid JSON")
		return
	}
	obj, ok := parsed.(map[string]any)
	if !ok {
		jsonError(w, http.StatusBadRequest, "settings must be a JSON object")
		return
	}
	if err := settings.Save(settings.File(s.StateDirs, ""), obj); err != nil {
		jsonError(w, http.StatusInternalServerError, "failed to persist settings")
		return
	}
	writeJSON(w, http.StatusOK, obj)
}
