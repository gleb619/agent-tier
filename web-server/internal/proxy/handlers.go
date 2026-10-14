package proxy

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"

	"web-server/internal/static"
)

// handleCreateRun validates the request body, then spawns `at` detached.
// The bridge does not yet expose a "create run" verb — adding one would
// require the runner to ship an at bridge create-run flow that mirrors
// `at -p ... -a ... -t ... -s`, which is the spawn path we replicate here.
//
// Request body: { prompt: string, agent?: string, tier?: 1|2|3|4, cwd?: string }
// Response 202: { ok: true }
func (s *Server) handleCreateRun(w http.ResponseWriter, r *http.Request) {
	body, err := bodyToMap(r)
	if err != nil {
		jsonError(w, http.StatusBadRequest, "invalid JSON body")
		return
	}
	prompt, _ := body["prompt"].(string)
	if strings.TrimSpace(prompt) == "" {
		jsonError(w, http.StatusBadRequest, "prompt is required")
		return
	}
	args := []string{"-p", prompt}
	if v, present := body["agent"]; present {
		agent, ok := v.(string)
		if !ok {
			jsonError(w, http.StatusBadRequest, "agent must be a string")
			return
		}
		if agent != "" {
			args = append(args, "-a", agent)
		}
	}
	if tier, present := body["tier"]; present {
		v, ok := tier.(float64)
		if !ok {
			jsonError(w, http.StatusBadRequest, "tier must be a number")
			return
		}
		if v < 1 || v > 4 {
			jsonError(w, http.StatusBadRequest, "tier must be 1..4")
			return
		}
		args = append(args, "-t", strconv.Itoa(int(v)))
	}
	if v, present := body["cwd"]; present {
		cwd, ok := v.(string)
		if !ok {
			jsonError(w, http.StatusBadRequest, "cwd must be a string")
			return
		}
		if cwd != "" {
			args = append(args, "-C", cwd)
		}
	}

	if err := s.SpawnAt(args...); err != nil {
		jsonError(w, http.StatusBadGateway, fmt.Sprintf("failed to spawn at: %v", err))
		return
	}
	writeJSON(w, http.StatusAccepted, map[string]bool{"ok": true})
}

// handleRetryRun loads the run record (via `at bridge runs get`), respawns
// with the stored prompt/agent/tier, and returns 202. 404 on unknown id.
func (s *Server) handleRetryRun(w http.ResponseWriter, r *http.Request, id string) {
	res := Call(r.Context(), s.AtBin, "runs", "get", id, nil)
	if res.Err != nil {
		if res.Code == "NOT_FOUND" {
			jsonError(w, http.StatusNotFound, "run not found")
			return
		}
		if res.Code != "" {
			jsonError(w, HTTPStatus(res.Code), res.Message)
			return
		}
		jsonError(w, http.StatusBadGateway, res.Err.Error())
		return
	}
	var run struct {
		Prompt string  `json:"prompt"`
		Agent  string  `json:"agent"`
		Tier   float64 `json:"tier"`
	}
	if err := json.Unmarshal(res.Data, &run); err != nil || strings.TrimSpace(run.Prompt) == "" {
		jsonError(w, http.StatusBadGateway, "stored run is missing prompt/agent/tier")
		return
	}
	args := []string{"-p", run.Prompt, "-a", run.Agent, "-t", strconv.Itoa(int(run.Tier))}
	if err := s.SpawnAt(args...); err != nil {
		jsonError(w, http.StatusBadGateway, fmt.Sprintf("failed to spawn at: %v", err))
		return
	}
	writeJSON(w, http.StatusAccepted, map[string]bool{"ok": true})
}

// handleDeleteRun proxies to `at bridge runs stop`. ?force=1 → force.
// Response shape keeps the old { ok: true } contract (used by the WebUI's
// ApiClient.deleteRun) alongside the bridge's detail payload so dashboards
// can also display the pid/signal that were used.
func (s *Server) handleDeleteRun(w http.ResponseWriter, r *http.Request, id string) {
	params := map[string]any{"force": r.URL.Query().Get("force") == "1"}
	res := Call(r.Context(), s.AtBin, "runs", "stop", id, params)
	if res.Err != nil {
		if res.Code == "NOT_FOUND" {
			jsonError(w, http.StatusNotFound, "run not found")
			return
		}
		if res.Code != "" {
			jsonError(w, HTTPStatus(res.Code), res.Message)
			return
		}
		jsonError(w, http.StatusBadGateway, res.Err.Error())
		return
	}
	// Wrap the bridge payload in { ok: true, ... } so legacy callers and
	// the WebUI's ApiClient.deleteRun contract both remain satisfied.
	var detail map[string]any
	_ = json.Unmarshal(res.Data, &detail)
	if detail == nil {
		detail = map[string]any{}
	}
	detail["ok"] = true
	writeJSON(w, http.StatusOK, detail)
}

// handleRunLog tails <stateDir>/<runId>.log on disk. `at bridge runs get`
// exposes the logFile path (we already decode it above for retry). Lines is
// the same `?lines=N` query string the old endpoint used.
func (s *Server) handleRunLog(w http.ResponseWriter, r *http.Request, id string) {
	getRes := Call(r.Context(), s.AtBin, "runs", "get", id, nil)
	if getRes.Err != nil {
		if getRes.Code == "NOT_FOUND" {
			jsonError(w, http.StatusNotFound, "run not found")
			return
		}
		if getRes.Code != "" {
			jsonError(w, HTTPStatus(getRes.Code), getRes.Message)
			return
		}
		jsonError(w, http.StatusBadGateway, getRes.Err.Error())
		return
	}
	var run struct {
		RunID   string `json:"runId"`
		LogFile string `json:"logFile"`
	}
	if err := json.Unmarshal(getRes.Data, &run); err != nil || run.LogFile == "" {
		jsonError(w, http.StatusNotFound, "log file not found")
		return
	}
	lines := 200
	if raw := r.URL.Query().Get("lines"); raw != "" {
		if n, err := strconv.Atoi(raw); err == nil && n > 0 {
			lines = n
		}
	}
	tail, err := tailFile(run.LogFile, lines)
	if err != nil {
		jsonError(w, http.StatusNotFound, "log file not found")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"runId": run.RunID, "lines": tail})
}

// tailFile returns the last n lines (or all of them if the file is shorter).
// Empty file → empty slice.
func tailFile(path string, n int) ([]string, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer f.Close()
	raw, err := io.ReadAll(f)
	if err != nil {
		return nil, err
	}
	if len(raw) == 0 {
		return []string{}, nil
	}
	all := strings.Split(strings.TrimRight(string(raw), "\n"), "\n")
	if len(all) <= n {
		return all, nil
	}
	return all[len(all)-n:], nil
}

// handleDiscuss maps GET (with optional pending=1) → `at bridge discuss list`
// and POST → `at bridge discuss {answer,say}` based on the body's `kind`.
func (s *Server) handleDiscuss(w http.ResponseWriter, r *http.Request, id string) {
	switch r.Method {
	case http.MethodGet:
		params := map[string]any{"runId": id}
		if r.URL.Query().Get("pending") == "1" {
			params["pending"] = true
		}
		res := Call(r.Context(), s.AtBin, "discuss", "list", id, params)
		if res.Err != nil {
			if res.Code == "NOT_FOUND" {
				jsonError(w, http.StatusNotFound, "run not found")
				return
			}
			if res.Code != "" {
				jsonError(w, HTTPStatus(res.Code), res.Message)
				return
			}
			jsonError(w, http.StatusBadGateway, res.Err.Error())
			return
		}
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write(res.Data)

	case http.MethodPost:
		body, err := bodyToMap(r)
		if err != nil {
			jsonError(w, http.StatusBadRequest, "invalid JSON body")
			return
		}
		text, _ := body["text"].(string)
		if strings.TrimSpace(text) == "" {
			jsonError(w, http.StatusBadRequest, "text is required")
			return
		}
		verb := "say"
		params := map[string]any{"runId": id, "text": text}
		switch kind, _ := body["kind"].(string); kind {
		case "answer":
			verb = "answer"
			if replyTo, ok := body["replyTo"].(string); ok {
				params["replyTo"] = replyTo
			}
		case "say", "":
			verb = "say"
		default:
			jsonError(w, http.StatusBadRequest, "kind must be 'answer' or 'say'")
			return
		}
		res := Call(r.Context(), s.AtBin, "discuss", verb, id, params)
		if res.Err != nil {
			if res.Code == "NOT_FOUND" {
				jsonError(w, http.StatusNotFound, "run not found")
				return
			}
			if res.Code != "" {
				jsonError(w, HTTPStatus(res.Code), res.Message)
				return
			}
			jsonError(w, http.StatusBadGateway, res.Err.Error())
			return
		}
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusAccepted)
		_, _ = w.Write(res.Data)
	default:
		jsonError(w, http.StatusMethodNotAllowed, "method not allowed")
	}
}

// handleAgentToggle execs `at {enable,disable} <name>` directly. The bridge
// does not expose these (they write config.json with HMAC re-sign) so we
// defer to the CLI. 404 on unknown name surfaces as a non-zero exit.
func (s *Server) handleAgentToggle(w http.ResponseWriter, r *http.Request, name, action string) {
	if _, err := s.RunAt(r.Context(), action, name); err != nil {
		// `at` exits non-zero on unknown agent names; expose that as 404.
		// Anything else (CLI missing, IO failure) → 502.
		msg := err.Error()
		if strings.Contains(msg, "Unknown agent") || strings.Contains(strings.ToLower(msg), "unknown agent") {
			jsonError(w, http.StatusNotFound, "agent not found")
			return
		}
		jsonError(w, http.StatusBadGateway, fmt.Sprintf("failed to run `at %s %s`: %v", action, name, err))
		return
	}
	w.WriteHeader(http.StatusAccepted)
}

// handleStats is a derived view: it runs `at bridge runs list` once and
// `at bridge agents health` once, then aggregates counts. No new state on
// disk — same freshness as `at status --json`.
func (s *Server) handleStats(w http.ResponseWriter, r *http.Request) {
	runsRes := Call(r.Context(), s.AtBin, "runs", "list", "", nil)
	if runsRes.Err != nil {
		if runsRes.Code != "" {
			jsonError(w, HTTPStatus(runsRes.Code), runsRes.Message)
			return
		}
		jsonError(w, http.StatusBadGateway, runsRes.Err.Error())
		return
	}
	var runs []map[string]any
	_ = json.Unmarshal(runsRes.Data, &runs)

	stats := map[string]any{
		"total":   len(runs),
		"running": 0,
		"done":    0,
		"failed":  0,
		"stuck":   0,
		"agents":  map[string]any{"total": 0, "deactivated": 0},
	}
	for _, run := range runs {
		if s, ok := run["status"].(string); ok {
			if key, exists := stats[s]; exists {
				stats[s] = key.(int) + 1
			}
		}
	}

	agentsRes := Call(r.Context(), s.AtBin, "agents", "health", "", nil)
	if agentsRes.Err == nil {
		var agents []map[string]any
		_ = json.Unmarshal(agentsRes.Data, &agents)
		deactivated := 0
		for _, a := range agents {
			if d, _ := a["deactivated"].(bool); d {
				deactivated++
			}
		}
		stats["agents"] = map[string]any{
			"total":       len(agents),
			"deactivated": deactivated,
		}
	} else {
		// Without agents health, total stays 0 — the dashboard hides the
		// tile rather than show "0/0 agents".
		stats["agents"] = map[string]any{"total": 0, "deactivated": 0}
	}
	writeJSON(w, http.StatusOK, stats)
}

// handleSettingsGet reads <stateDir>/web-settings.json directly (same shape
// as the deleted `internal/settings` package). The bridge does not expose
// settings; this is a 30-LOC thin wrapper.
func (s *Server) handleSettingsGet(w http.ResponseWriter, _ *http.Request) {
	path := settingsPath()
	raw, err := os.ReadFile(path)
	if err != nil {
		writeJSON(w, http.StatusOK, map[string]any{})
		return
	}
	var v any
	if err := json.Unmarshal(raw, &v); err != nil {
		writeJSON(w, http.StatusOK, map[string]any{})
		return
	}
	if obj, ok := v.(map[string]any); ok {
		writeJSON(w, http.StatusOK, obj)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{})
}

// handleSettingsPut writes <stateDir>/web-settings.json atomically with
// the same temp+rename semantics the previous Go impl used.
func (s *Server) handleSettingsPut(w http.ResponseWriter, r *http.Request) {
	parsed, err := bodyToMap(r)
	if err != nil {
		jsonError(w, http.StatusBadRequest, "settings must be a JSON object")
		return
	}
	path := settingsPath()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		jsonError(w, http.StatusInternalServerError, "failed to prepare settings dir")
		return
	}
	buf, err := json.MarshalIndent(parsed, "", "  ")
	if err != nil {
		jsonError(w, http.StatusInternalServerError, "failed to marshal settings")
		return
	}
	buf = append(buf, '\n')
	tmp, err := os.CreateTemp(filepath.Dir(path), "web-settings.json.tmp-*")
	if err != nil {
		jsonError(w, http.StatusInternalServerError, "failed to open settings tmp")
		return
	}
	tmpName := tmp.Name()
	defer os.Remove(tmpName) // no-op after successful rename
	if _, err := tmp.Write(buf); err != nil {
		tmp.Close()
		jsonError(w, http.StatusInternalServerError, "failed to write settings tmp")
		return
	}
	if err := tmp.Sync(); err != nil {
		tmp.Close()
		jsonError(w, http.StatusInternalServerError, "failed to fsync settings tmp")
		return
	}
	if err := tmp.Close(); err != nil {
		jsonError(w, http.StatusInternalServerError, "failed to close settings tmp")
		return
	}
	if err := os.Rename(tmpName, path); err != nil {
		jsonError(w, http.StatusInternalServerError, "failed to rename settings tmp")
		return
	}
	writeJSON(w, http.StatusOK, parsed)
}

// settingsPath mirrors the deleted `internal/settings.File` resolution:
// state-dir from AT_STATE_DIR env wins; otherwise the joined `.at/` inside
// the current cwd (matches `at status` resolution).
func settingsPath() string {
	if env := os.Getenv("AT_STATE_DIR"); env != "" {
		return filepath.Join(env, "web-settings.json")
	}
	cwd, _ := os.Getwd()
	return filepath.Join(cwd, ".at", "web-settings.json")
}

// staticHandler alias keeps the static import "used" when only types are
// referenced; cheap protection against the linter trimming the import.
var _ = static.Handler
