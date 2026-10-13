package events

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"sync"
	"time"
)

const heartbeatInterval = 15 * time.Second

// Hub implements the SSE event stream + discuss channel. Storage is
// byte-compatible with the Node notify hub (src/notify/hub.ts) so TS and Go
// processes can share the same state dir.
type Hub struct {
	StateDir          string
	HeartbeatInterval time.Duration
	mu                sync.Mutex
	clients           map[*client]struct{}
	seqMap            map[string]int
}

type client struct {
	runID    string
	sinceSeq int
	ch       chan Event
}

// NewHub creates an SSE/discuss hub rooted at stateDir.
func NewHub(stateDir string) *Hub {
	return &Hub{
		StateDir:          stateDir,
		HeartbeatInterval: heartbeatInterval,
		clients:           make(map[*client]struct{}),
		seqMap:            make(map[string]int),
	}
}

// Close disconnects all subscribers.
func (h *Hub) Close() error {
	h.mu.Lock()
	defer h.mu.Unlock()
	for c := range h.clients {
		close(c.ch)
		delete(h.clients, c)
	}
	return nil
}

func (h *Hub) loadSeq(runID string) int {
	if seq, ok := h.seqMap[runID]; ok {
		return seq
	}
	events, _ := readEvents(h.StateDir, runID)
	return maxSeq(events)
}

func (h *Hub) nextSeq(runID string) int {
	h.mu.Lock()
	defer h.mu.Unlock()
	seq := h.loadSeq(runID) + 1
	h.seqMap[runID] = seq
	return seq
}

func (h *Hub) normalize(e Event) Event {
	if e.Seq <= 0 {
		e.Seq = h.nextSeq(e.RunID)
	}
	if e.TS == "" {
		e.TS = time.Now().UTC().Format(time.RFC3339Nano)
	}
	return e
}

// Publish persists an event and broadcasts it to matching subscribers.
func (h *Hub) Publish(e Event) {
	e = h.normalize(e)
	_ = appendJSONL(eventFile(h.StateDir, e.RunID), e)

	h.mu.Lock()
	defer h.mu.Unlock()
	for c := range h.clients {
		if c.runID != "" && c.runID != e.RunID {
			continue
		}
		select {
		case c.ch <- e:
		default:
			// backpressure: drop for this subscriber rather than block
		}
	}
}

// subscription is returned to an HTTP handler; replay events are delivered
// synchronously, then live events on ch.
type subscription struct {
	ch     chan Event
	replay []Event
}

func (h *Hub) subscribe(runID string, sinceSeq int) *subscription {
	h.mu.Lock()
	defer h.mu.Unlock()

	var replay []Event
	if runID == "" {
		replay, _ = readAllEvents(h.StateDir)
		// filter by sinceSeq
		var filtered []Event
		for _, e := range replay {
			if e.Seq > sinceSeq {
				filtered = append(filtered, e)
			}
		}
		replay = filtered
	} else {
		replay, _ = readEventsSince(h.StateDir, runID, sinceSeq)
	}

	ch := make(chan Event, 16)
	c := &client{runID: runID, sinceSeq: sinceSeq, ch: ch}
	h.clients[c] = struct{}{}
	return &subscription{ch: ch, replay: replay}
}

func (h *Hub) unsubscribe(sub *subscription) {
	h.mu.Lock()
	defer h.mu.Unlock()
	for c := range h.clients {
		if c.ch == sub.ch {
			close(c.ch)
			delete(h.clients, c)
			return
		}
	}
}

func sseLine(e Event) string {
	data, _ := json.Marshal(e)
	return fmt.Sprintf("id: %d\nevent: %s\ndata: %s\n\n", e.Seq, e.Type, string(data))
}

// ServeEvents writes an SSE stream for one run (runID != "") or all runs.
func (h *Hub) ServeEvents(w http.ResponseWriter, r *http.Request, runID string) {
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	w.WriteHeader(http.StatusOK)
	if f, ok := w.(http.Flusher); ok {
		f.Flush()
	}

	sinceSeq := 0
	if raw := r.Header.Get("Last-Event-ID"); raw != "" {
		if n, err := strconv.Atoi(raw); err == nil {
			sinceSeq = n
		}
	}

	sub := h.subscribe(runID, sinceSeq)
	defer h.unsubscribe(sub)

	// Replay persisted events first.
	for _, e := range sub.replay {
		if _, err := w.Write([]byte(sseLine(e))); err != nil {
			return
		}
	}
	if f, ok := w.(http.Flusher); ok {
		f.Flush()
	}

	ticker := time.NewTicker(h.HeartbeatInterval)
	defer ticker.Stop()

	for {
		select {
		case e, ok := <-sub.ch:
			if !ok {
				return
			}
			if _, err := w.Write([]byte(sseLine(e))); err != nil {
				return
			}
			if f, ok := w.(http.Flusher); ok {
				f.Flush()
			}
		case <-ticker.C:
			if _, err := w.Write([]byte(": heartbeat\n\n")); err != nil {
				return
			}
			if f, ok := w.(http.Flusher); ok {
				f.Flush()
			}
		case <-r.Context().Done():
			return
		}
	}
}

// extractPathID parses a path like "/events/abc" or "/discuss/abc" and
// returns "abc". It accepts a leading prefix to strip.
func extractPathID(path, prefix string) (string, bool) {
	rest := strings.TrimPrefix(path, prefix)
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

// HandleEventsRoute serves GET /events or /events/:runId.
func (h *Hub) HandleEventsRoute(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	path := r.URL.Path
	var runID string
	if path == "/events" {
		runID = ""
	} else {
		var ok bool
		runID, ok = extractPathID(path, "/events")
		if !ok {
			http.Error(w, "not found", http.StatusNotFound)
			return
		}
	}
	h.ServeEvents(w, r, runID)
}

// emitBody is the POST /emit/:runId payload (partial event).
type emitBody struct {
	Type string         `json:"type"`
	Text string         `json:"text"`
	Data map[string]any `json:"data"`
}

// HandleEmitRoute serves POST /emit/:runId.
func (h *Hub) HandleEmitRoute(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	runID, ok := extractPathID(r.URL.Path, "/emit")
	if !ok {
		http.Error(w, "not found", http.StatusNotFound)
		return
	}
	body, err := io.ReadAll(http.MaxBytesReader(w, r.Body, 1<<20))
	if err != nil {
		http.Error(w, "bad request", http.StatusBadRequest)
		return
	}
	var parsed emitBody
	if err := json.Unmarshal(body, &parsed); err != nil {
		http.Error(w, "bad request", http.StatusBadRequest)
		return
	}
	h.Publish(Event{
		RunID: runID,
		Agent: "agent",
		Type:  EventType(parsed.Type),
		Text:  parsed.Text,
		Data:  parsed.Data,
	})
	w.WriteHeader(http.StatusAccepted)
	w.Write([]byte("ok")) //nolint:errcheck
}

// discussPostBody is the POST /discuss/:runId payload.
type discussPostBody struct {
	From    string   `json:"from"`
	Kind    string   `json:"kind"`
	Text    string   `json:"text"`
	Options []string `json:"options"`
	ReplyTo string   `json:"replyTo"`
}

// HandleDiscussRoute serves GET/POST /discuss/:runId and is also called by
// the API layer for /api/runs/:id/discuss after validating the run exists.
func (h *Hub) HandleDiscussRoute(w http.ResponseWriter, r *http.Request, runID string) {
	switch r.Method {
	case http.MethodGet:
		h.handleDiscussGet(w, r, runID)
	case http.MethodPost:
		h.handleDiscussPost(w, r, runID)
	default:
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
	}
}

func (h *Hub) handleDiscussGet(w http.ResponseWriter, r *http.Request, runID string) {
	var list []DiscussEntry
	var err error
	if r.URL.Query().Get("pending") == "1" {
		list, err = unansweredQuestions(h.StateDir, runID)
	} else {
		list, err = readDiscuss(h.StateDir, runID)
	}
	if err != nil {
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}
	writeJSON(w, http.StatusOK, list)
}

func (h *Hub) handleDiscussPost(w http.ResponseWriter, r *http.Request, runID string) {
	body, err := io.ReadAll(http.MaxBytesReader(w, r.Body, 1<<20))
	if err != nil {
		http.Error(w, "bad request", http.StatusBadRequest)
		return
	}
	var parsed discussPostBody
	if err := json.Unmarshal(body, &parsed); err != nil {
		http.Error(w, "bad request", http.StatusBadRequest)
		return
	}

	from := FromAgent
	if parsed.From == string(FromHost) {
		from = FromHost
	}
	var kind DiscussKind
	switch parsed.Kind {
	case string(KindQuestion):
		kind = KindQuestion
	case string(KindAnswer):
		kind = KindAnswer
	case string(KindSay):
		kind = KindSay
	case string(KindNote):
		kind = KindNote
	default:
		http.Error(w, "bad request", http.StatusBadRequest)
		return
	}
	if strings.TrimSpace(parsed.Text) == "" {
		http.Error(w, "bad request", http.StatusBadRequest)
		return
	}

	id, err := nextDiscussID(h.StateDir, runID)
	if err != nil {
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}
	entry := DiscussEntry{
		ID:      id,
		From:    from,
		Kind:    kind,
		Text:    parsed.Text,
		Options: parsed.Options,
		ReplyTo: parsed.ReplyTo,
		TS:      time.Now().UTC().Format(time.RFC3339Nano),
	}
	if err := appendJSONL(discussFile(h.StateDir, runID), entry); err != nil {
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}

	// Mirror as SSE event.
	sseType := TypeMessage
	if kind == KindQuestion || kind == KindAnswer {
		sseType = EventType(kind)
	}
	h.Publish(Event{
		RunID: runID,
		Agent: string(from),
		TS:    entry.TS,
		Type:  sseType,
		Text:  entry.Text,
		Data: map[string]any{
			"id":      entry.ID,
			"kind":    entry.Kind,
			"options": entry.Options,
			"replyTo": entry.ReplyTo,
			"from":    entry.From,
		},
	})

	writeJSON(w, http.StatusAccepted, map[string]string{"id": entry.ID})
}

func writeJSON(w http.ResponseWriter, status int, data any) {
	out, err := json.Marshal(data)
	if err != nil {
		http.Error(w, `{"error":"marshal failure"}`, http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	w.Write(out) //nolint:errcheck
}
