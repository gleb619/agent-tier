package events

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"
)

func seedDiscuss(t *testing.T, dir, runID string, entries ...DiscussEntry) {
	t.Helper()
	path := discussFile(dir, runID)
	_ = os.MkdirAll(eventsDir(dir), 0o755)
	f, err := os.OpenFile(path, os.O_APPEND|os.O_WRONLY|os.O_CREATE, 0o644)
	if err != nil {
		t.Fatal(err)
	}
	defer f.Close()
	for _, e := range entries {
		raw, _ := json.Marshal(e)
		if _, err := f.Write(append(raw, '\n')); err != nil {
			t.Fatal(err)
		}
	}
}

func TestDiscussGetAndPending(t *testing.T) {
	dir := t.TempDir()
	h := NewHub(dir)
	defer h.Close()

	seedDiscuss(t, dir, "d1",
		DiscussEntry{ID: "m1", From: FromAgent, Kind: KindQuestion, Text: "q1?", TS: time.Now().UTC().Format(time.RFC3339Nano)},
		DiscussEntry{ID: "m2", From: FromHost, Kind: KindAnswer, Text: "a1", ReplyTo: "m1", TS: time.Now().UTC().Format(time.RFC3339Nano)},
		DiscussEntry{ID: "m3", From: FromAgent, Kind: KindQuestion, Text: "q2?", TS: time.Now().UTC().Format(time.RFC3339Nano)},
	)

	req := httptest.NewRequest(http.MethodGet, "/discuss/d1", nil)
	rec := httptest.NewRecorder()
	h.HandleDiscussRoute(rec, req, "d1")
	if rec.Code != http.StatusOK {
		t.Fatalf("GET = %d %s", rec.Code, rec.Body.String())
	}
	var full []DiscussEntry
	if err := json.Unmarshal(rec.Body.Bytes(), &full); err != nil {
		t.Fatal(err)
	}
	if len(full) != 3 {
		t.Fatalf("full = %v", full)
	}

	req2 := httptest.NewRequest(http.MethodGet, "/discuss/d1?pending=1", nil)
	rec2 := httptest.NewRecorder()
	h.HandleDiscussRoute(rec2, req2, "d1")
	var pending []DiscussEntry
	if err := json.Unmarshal(rec2.Body.Bytes(), &pending); err != nil {
		t.Fatal(err)
	}
	if len(pending) != 1 || pending[0].Text != "q2?" {
		t.Fatalf("pending = %v", pending)
	}
}

func TestDiscussPostAnswer(t *testing.T) {
	dir := t.TempDir()
	h := NewHub(dir)
	defer h.Close()

	seedDiscuss(t, dir, "d2", DiscussEntry{ID: "m1", From: FromAgent, Kind: KindQuestion, Text: "go?", TS: time.Now().UTC().Format(time.RFC3339Nano)})

	body := map[string]any{"kind": "answer", "text": "yes", "replyTo": "m1", "from": "host"}
	req := httptest.NewRequest(http.MethodPost, "/discuss/d2", bytes.NewReader(mustJSON(t, body)))
	rec := httptest.NewRecorder()
	h.HandleDiscussRoute(rec, req, "d2")
	if rec.Code != http.StatusAccepted {
		t.Fatalf("POST = %d %s", rec.Code, rec.Body.String())
	}
	var out map[string]string
	if err := json.Unmarshal(rec.Body.Bytes(), &out); err != nil {
		t.Fatal(err)
	}
	if out["id"] != "m2" {
		t.Fatalf("id = %v", out)
	}

	pending, _ := unansweredQuestions(dir, "d2")
	if len(pending) != 0 {
		t.Fatalf("pending after answer = %v", pending)
	}
}

func TestDiscussPostValidation(t *testing.T) {
	dir := t.TempDir()
	h := NewHub(dir)
	defer h.Close()

	cases := []map[string]any{
		{"kind": "answer", "text": ""},
		{"kind": "nope", "text": "hi"},
		{"text": "hi"},
	}
	for _, c := range cases {
		req := httptest.NewRequest(http.MethodPost, "/discuss/d3", bytes.NewReader(mustJSON(t, c)))
		rec := httptest.NewRecorder()
		h.HandleDiscussRoute(rec, req, "d3")
		if rec.Code != http.StatusBadRequest {
			t.Fatalf("body %v => %d", c, rec.Code)
		}
	}
}

func TestDiscussPostMirrorsSSE(t *testing.T) {
	dir := t.TempDir()
	h := NewHub(dir)
	defer h.Close()

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/events/d4", nil)
	done := make(chan struct{})
	go func() {
		h.ServeEvents(rec, req, "d4")
		close(done)
	}()
	time.Sleep(30 * time.Millisecond)

	body := map[string]any{"kind": "say", "text": "hello host", "from": "host"}
	post := httptest.NewRequest(http.MethodPost, "/discuss/d4", bytes.NewReader(mustJSON(t, body)))
	postrec := httptest.NewRecorder()
	h.HandleDiscussRoute(postrec, post, "d4")
	if postrec.Code != http.StatusAccepted {
		t.Fatalf("POST = %d", postrec.Code)
	}

	time.Sleep(30 * time.Millisecond)
	h.Close()
	<-done

	if !strings.Contains(rec.Body.String(), `"type":"message"`) || !strings.Contains(rec.Body.String(), `"text":"hello host"`) {
		t.Fatalf("body = %s", rec.Body.String())
	}
}

func TestDiscussQuestionMirrorType(t *testing.T) {
	dir := t.TempDir()
	h := NewHub(dir)
	defer h.Close()

	body := map[string]any{"kind": "question", "text": "ok?", "options": []string{"yes", "no"}, "from": "agent"}
	req := httptest.NewRequest(http.MethodPost, "/discuss/d5", bytes.NewReader(mustJSON(t, body)))
	rec := httptest.NewRecorder()
	h.HandleDiscussRoute(rec, req, "d5")
	if rec.Code != http.StatusAccepted {
		t.Fatalf("POST = %d", rec.Code)
	}

	loaded, _ := readDiscuss(dir, "d5")
	if len(loaded) != 1 || loaded[0].Kind != KindQuestion || len(loaded[0].Options) != 2 {
		t.Fatalf("loaded = %v", loaded)
	}
}

func mustJSON(t *testing.T, v any) []byte {
	t.Helper()
	b, err := json.Marshal(v)
	if err != nil {
		t.Fatal(err)
	}
	return b
}
