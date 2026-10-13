package api

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"syscall"
	"time"

	"web-server/internal/runs"
)

const (
	agentsCacheTTL = 5 * time.Second
	atCommandTTL   = 10 * time.Second
)

// createRunBody mirrors the POST /api/runs payload accepted by the Node
// server: prompt required; agent/tier/cwd optional and validated only.
type createRunBody struct {
	Prompt string  `json:"prompt"`
	Agent  *string `json:"agent"`
	Tier   *int    `json:"tier"`
	Cwd    *string `json:"cwd"`
}

// agentEntry is one row of the `at agents --json` payload (same shape as
// buildAgentsReport in src/agents/report.ts and the Node /api/agents row).
type agentEntry struct {
	Name        string  `json:"name"`
	Tier        int     `json:"tier"`
	PromptMode  string  `json:"promptMode,omitempty"`
	Deactivated bool    `json:"deactivated"`
	Failures    int     `json:"failures"`
	LastFailure *string `json:"lastFailure"`
	DisabledTo  *string `json:"disabledTo"`
}

// buildAtArgs mirrors buildAtArgs in src/web/server.ts: -p prompt, plus
// -a agent / -t tier when present.
func buildAtArgs(prompt string, agent *string, tier *int) []string {
	args := []string{"-p", prompt}
	if agent != nil && *agent != "" {
		args = append(args, "-a", *agent)
	}
	if tier != nil && *tier != 0 {
		args = append(args, "-t", strconv.Itoa(*tier))
	}
	return args
}

// defaultSpawnAt launches the `at` CLI detached in its own session (like the
// Node runner), with AT_STATE_DIR pinned to the primary state dir so the
// child lands its run record where this server reads. Spawn errors are
// ignored, matching the Node server's fire-and-forget spawnAt.
func (s *Server) defaultSpawnAt(args ...string) error {
	cmd := exec.Command(s.AtBin, args...)
	env := append(os.Environ(), "AT_STATE_DIR="+s.StateDirs[0])
	if s.BaseURL != "" {
		env = append(env, "AT_SSE_URL="+s.BaseURL)
	}
	cmd.Env = env
	devnull, err := os.OpenFile(os.DevNull, os.O_RDWR, 0)
	if err != nil {
		return err
	}
	defer devnull.Close()
	cmd.Stdin = devnull
	cmd.Stdout = devnull
	cmd.Stderr = devnull
	cmd.SysProcAttr = &syscall.SysProcAttr{Setsid: true}
	if err := cmd.Start(); err != nil {
		return nil //nolint:nilerr // fire-and-forget, same as the Node server
	}
	return cmd.Process.Release()
}

// defaultRunAt runs the `at` CLI synchronously and returns stdout. With a
// single state dir, AT_STATE_DIR pins it (same as defaultSpawnAt).
func (s *Server) defaultRunAt(_ context.Context, args ...string) (string, error) {
	ctx, cancel := context.WithTimeout(context.Background(), atCommandTTL)
	defer cancel()
	cmd := exec.CommandContext(ctx, s.AtBin, args...)
	if len(s.StateDirs) == 1 {
		cmd.Env = append(os.Environ(), "AT_STATE_DIR="+s.StateDirs[0])
	}
	out, err := cmd.Output()
	if err != nil {
		var exitErr *exec.ExitError
		if errors.As(err, &exitErr) {
			return "", fmt.Errorf("%w: %s", err, strings.TrimSpace(string(exitErr.Stderr)))
		}
		return "", err
	}
	return string(out), nil
}

func (s *Server) spawn(args ...string) error {
	if s.SpawnAt != nil {
		return s.SpawnAt(args...)
	}
	return s.defaultSpawnAt(args...)
}

func (s *Server) runAt(ctx context.Context, args ...string) (string, error) {
	if s.RunAt != nil {
		return s.RunAt(ctx, args...)
	}
	return s.defaultRunAt(ctx, args...)
}

// handleCreateRun implements POST /api/runs.
func (s *Server) handleCreateRun(w http.ResponseWriter, r *http.Request) {
	r.Body = http.MaxBytesReader(w, r.Body, maxBodyBytes)
	var body createRunBody
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		jsonError(w, http.StatusBadRequest, "invalid JSON")
		return
	}
	if strings.TrimSpace(body.Prompt) == "" {
		jsonError(w, http.StatusBadRequest, "prompt is required")
		return
	}
	if body.Agent != nil && *body.Agent == "" {
		jsonError(w, http.StatusBadRequest, "agent must be a non-empty string")
		return
	}
	if body.Tier != nil && (*body.Tier < 1 || *body.Tier > 4) {
		jsonError(w, http.StatusBadRequest, "tier must be 1, 2, 3 or 4")
		return
	}
	if body.Cwd != nil && *body.Cwd == "" {
		jsonError(w, http.StatusBadRequest, "cwd must be a non-empty string")
		return
	}
	_ = s.spawn(buildAtArgs(body.Prompt, body.Agent, body.Tier)...)
	writeJSON(w, http.StatusAccepted, map[string]bool{"ok": true})
}

// handleRetry implements POST /api/runs/:id/retry.
func (s *Server) handleRetry(w http.ResponseWriter, r *http.Request, idSegment string) {
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
	agent := run.Agent
	tier := run.Tier
	_ = s.spawn(buildAtArgs(run.Prompt, &agent, &tier)...)
	writeJSON(w, http.StatusAccepted, map[string]bool{"ok": true})
}

// killPidGroup signals the run's whole process tree (the stored pid is a
// detached group leader, like `at stop`), falling back to the bare pid.
func killPidGroup(pid int, sig syscall.Signal) {
	if err := syscall.Kill(-pid, sig); err != nil {
		_ = syscall.Kill(pid, sig)
	}
}

// handleDeleteRun implements DELETE /api/runs/:id (?force=1 → SIGKILL).
// Kills the process group when alive (idempotent on dead pids) and marks
// the run failed under the TS lock protocol.
func (s *Server) handleDeleteRun(w http.ResponseWriter, r *http.Request, idSegment string) {
	id, err := urlUnescape(idSegment)
	if err != nil {
		jsonError(w, http.StatusBadRequest, "bad run id")
		return
	}
	run, dir, ok := runs.FindRun(s.StateDirs, id)
	if !ok {
		jsonError(w, http.StatusNotFound, "run not found")
		return
	}
	if runs.PidAlive(run.Pid) {
		sig := syscall.SIGTERM
		if r.URL.Query().Get("force") == "1" {
			sig = syscall.SIGKILL
		}
		killPidGroup(run.Pid, sig)
	}
	finishedAt := runs.NowISO(time.Now())
	if err := runs.UpdateRun(dir, run.RunID, map[string]any{"status": "failed", "finishedAt": finishedAt}); err != nil {
		jsonError(w, http.StatusInternalServerError, "failed to update run")
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

// handleAgents implements GET /api/agents by shelling out to
// `at agents --json` (cached ~5s), keeping registry knowledge in the CLI.
func (s *Server) handleAgents(w http.ResponseWriter, r *http.Request) {
	s.agentsMu.Lock()
	if s.agentsCache != nil && time.Since(s.agentsCachedAt) < agentsCacheTTL {
		cached := s.agentsCache
		s.agentsMu.Unlock()
		writeJSON(w, http.StatusOK, cached)
		return
	}
	s.agentsMu.Unlock()

	out, err := s.runAt(r.Context(), "agents", "--json")
	if err != nil {
		jsonError(w, http.StatusBadGateway, "at agents --json failed")
		return
	}
	var entries []agentEntry
	if err := json.Unmarshal([]byte(out), &entries); err != nil {
		jsonError(w, http.StatusBadGateway, "at agents --json returned invalid JSON")
		return
	}

	s.agentsMu.Lock()
	s.agentsCache = entries
	s.agentsCachedAt = time.Now()
	s.agentsMu.Unlock()
	writeJSON(w, http.StatusOK, entries)
}

func (s *Server) invalidateAgentsCache() {
	s.agentsMu.Lock()
	s.agentsCache = nil
	s.agentsMu.Unlock()
}

// defaultGenericAgentsDir returns the base dir from which generic agents are
// discovered, matching loadGenericAgents in src/agents/generic-loader.ts: the
// AT_GENERIC_DIR env var, else ~/.at.
func defaultGenericAgentsDir() string {
	if d := os.Getenv("AT_GENERIC_DIR"); d != "" {
		return d
	}
	home, err := os.UserHomeDir()
	if err != nil {
		return "/.at"
	}
	return filepath.Join(home, ".at")
}

// countGenericAgents returns the number of generic agents (drop-in
// ~/.at/<name>/generic.js), matching loadGenericAgents in
// src/agents/generic-loader.ts.
func countGenericAgents() int {
	base := defaultGenericAgentsDir()
	entries, err := os.ReadDir(base)
	if err != nil {
		return 0
	}
	count := 0
	for _, entry := range entries {
		if entry.Name() == "." || entry.Name() == ".." {
			continue
		}
		if !entry.IsDir() {
			continue
		}
		if strings.Contains(entry.Name(), string(filepath.Separator)) {
			continue
		}
		candidate := filepath.Join(base, entry.Name(), "generic.js")
		if info, err := os.Stat(candidate); err == nil && !info.IsDir() {
			resolved, err := filepath.EvalSymlinks(candidate)
			if err != nil {
				continue
			}
			baseResolved, err := filepath.EvalSymlinks(base)
			if err != nil {
				continue
			}
			if resolved == baseResolved || strings.HasPrefix(resolved, baseResolved+string(filepath.Separator)) {
				count++
			}
		}
	}
	return count
}

// isGenericAgent reports whether the agent dir contains a generic.js
// entrypoint, matching loadGenericAgents in src/agents/generic-loader.ts.
func isGenericAgent(agent string) bool {
	base := defaultGenericAgentsDir()
	// Reject path traversal the same way node's path.join/startsWith guard does.
	if strings.Contains(agent, string(filepath.Separator)) {
		return false
	}
	candidate := filepath.Join(base, agent, "generic.js")
	info, err := os.Stat(candidate)
	if err != nil {
		return false
	}
	resolved, err := filepath.EvalSymlinks(candidate)
	if err != nil {
		return false
	}
	baseResolved, err := filepath.EvalSymlinks(base)
	if err != nil {
		return false
	}
	return !info.IsDir() && (resolved == baseResolved || strings.HasPrefix(resolved, baseResolved+string(filepath.Separator)))
}

// handleAgentAction implements PUT /api/agents/:name/enable|disable by
// delegating to `at enable|disable` (the CLI owns state.json and its lock).
// An agent is known if it is a builtin or a generic agent, mirroring
// [...AGENTS, ...loadGenericAgents()] in src/web/server.ts.
func (s *Server) handleAgentAction(w http.ResponseWriter, r *http.Request, nameSegment, action string) {
	name, err := urlUnescape(nameSegment)
	if err != nil || name == "" {
		jsonError(w, http.StatusBadRequest, "bad agent name")
		return
	}
	known := false
	for _, n := range builtinAgents {
		if n == name {
			known = true
			break
		}
	}
	if !known {
		known = isGenericAgent(name)
	}
	if !known {
		jsonError(w, http.StatusNotFound, "unknown agent")
		return
	}
	if _, err := s.runAt(r.Context(), action, name); err != nil {
		jsonError(w, http.StatusBadRequest, strings.TrimSpace(err.Error()))
		return
	}
	s.invalidateAgentsCache()
	writeJSON(w, http.StatusAccepted, map[string]bool{"ok": true})
}
