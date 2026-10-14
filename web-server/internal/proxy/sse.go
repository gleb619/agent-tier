package proxy

import (
	"bufio"
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
)

// handleSSE is the legacy /events and /events/:id entry point kept for
// backward compatibility with WebUI clients that still poll it. With
// bridge `events tail` today, the proxy exposes a single replay shot:
// one `at bridge events tail` call yields the stored events, formatted as
// SSE frames, then the stream closes. A follow-up T33+ release (the atd
// daemon) will replace this with the live in-memory fan-out.
//
// Resumes via the SSE Last-Event-ID header (the standard) are translated
// to `since=` for the bridge; explicit `?since=` query wins.
func (s *Server) handleSSE(w http.ResponseWriter, r *http.Request) {
	rest := strings.TrimPrefix(r.URL.Path, "/events")
	rest = strings.Trim(rest, "/")
	// Map /events/runId → runId; /events/ → "" (all runs); /events → "".
	id := ""
	if rest != "" && !strings.HasPrefix(rest, "/") {
		// `rest` may itself contain prefix leftovers if the mux matched a
		// longer path (e.g. /api/events/X). Take only the first segment.
		if idx := strings.Index(rest, "/"); idx >= 0 {
			id = rest[:idx]
		} else {
			id = rest
		}
	}

	params := map[string]any{}
	if id != "" {
		params["id"] = id
	}
	if v := r.URL.Query().Get("since"); v != "" {
		params["since"] = v
	} else if v := r.Header.Get("Last-Event-ID"); v != "" {
		params["since"] = v
	}
	res := Call(r.Context(), s.AtBin, "events", "tail", "", params)
	if res.Err != nil {
		if res.Code == "NOT_FOUND" {
			http.Error(w, "not found", http.StatusNotFound)
			return
		}
		if res.Code != "" {
			http.Error(w, res.Message, HTTPStatus(res.Code))
			return
		}
		http.Error(w, res.Err.Error(), http.StatusBadGateway)
		return
	}
	s.streamJSONAsSSE(w, res.Data)
}

// sseFromAPI is the alias used by the /api/* router; same contract as
// handleSSE but kept separate so callers see the right intent at the call
// site. (Restating the same handler keeps the refactor self-documenting.)
func (s *Server) sseFromAPI(w http.ResponseWriter, r *http.Request, id string) {
	s.handleSSE(w, r)
	_ = id // reserved for the future where /api/events branches differently
}

// streamJSONAsSSE serialises a JSON array as SSE frames: one `data:` line
// per element, terminated by an empty line. Empty / non-array payloads
// produce a no-op stream (immediately closed) — the contract the WebUI
// already copes with for "no events in window".
func (s *Server) streamJSONAsSSE(w http.ResponseWriter, payload []byte) {
	if len(payload) == 0 || string(payload) == "null" {
		return
	}
	// Test for an array without forcing a full unmarshal; we only need to
	// peek at the first non-space byte.
	trimmed := bytes.TrimLeft(payload, " \t\r\n")
	if len(trimmed) == 0 || trimmed[0] != '[' {
		// Not an array — wrap as a single object event.
		flusher, _ := w.(http.Flusher)
		w.Header().Set("Content-Type", "text/event-stream")
		w.Header().Set("Cache-Control", "no-cache")
		w.WriteHeader(http.StatusOK)
		_, _ = fmt.Fprintf(w, "data: %s\n\n", payload)
		if flusher != nil {
			flusher.Flush()
		}
		return
	}

	flusher, _ := w.(http.Flusher)
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.WriteHeader(http.StatusOK)

	dec := json.NewDecoder(bytes.NewReader(payload))
	// Read '['.
	_, _ = dec.Token()
	for dec.More() {
		var raw json.RawMessage
		if err := dec.Decode(&raw); err != nil {
			break
		}
		// Validate JSON shape (defensive — bridge already returns valid JSON).
		if !json.Valid(raw) {
			continue
		}
		if _, err := fmt.Fprintf(w, "data: %s\n\n", raw); err != nil {
			return
		}
		if flusher != nil {
			flusher.Flush()
		}
	}
}

// bufio is referenced via _ usage in tests; keep import stable.
var _ = bufio.NewScanner
