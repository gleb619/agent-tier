package events

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"
)

func TestStoreRoundtrip(t *testing.T) {
	dir := t.TempDir()
	e1 := Event{RunID: "r1", Agent: "mock", Type: TypeStart, Seq: 1, TS: time.Now().UTC().Format(time.RFC3339Nano)}
	e2 := Event{RunID: "r1", Agent: "mock", Type: TypeMessage, Seq: 2, TS: time.Now().UTC().Format(time.RFC3339Nano), Text: "hi"}
	if err := appendJSONL(eventFile(dir, "r1"), e1); err != nil {
		t.Fatal(err)
	}
	if err := appendJSONL(eventFile(dir, "r1"), e2); err != nil {
		t.Fatal(err)
	}

	loaded, err := readEvents(dir, "r1")
	if err != nil {
		t.Fatal(err)
	}
	if len(loaded) != 2 || loaded[0].Seq != 1 || loaded[1].Text != "hi" {
		t.Fatalf("loaded = %v", loaded)
	}

	since, err := readEventsSince(dir, "r1", 1)
	if err != nil {
		t.Fatal(err)
	}
	if len(since) != 1 || since[0].Seq != 2 {
		t.Fatalf("since = %v", since)
	}
}

func TestAllEventsSortedBySeq(t *testing.T) {
	dir := t.TempDir()
	_ = appendJSONL(eventFile(dir, "a"), Event{RunID: "a", Seq: 5, Type: TypeMessage})
	_ = appendJSONL(eventFile(dir, "b"), Event{RunID: "b", Seq: 2, Type: TypeMessage})
	_ = appendJSONL(eventFile(dir, "c"), Event{RunID: "c", Seq: 9, Type: TypeMessage})

	all, err := readAllEvents(dir)
	if err != nil {
		t.Fatal(err)
	}
	if len(all) != 3 || all[0].Seq != 2 || all[1].Seq != 5 || all[2].Seq != 9 {
		t.Fatalf("all = %v", all)
	}
}

func TestHubAutoSeqAndPublish(t *testing.T) {
	dir := t.TempDir()
	h := NewHub(dir)
	defer h.Close()

	h.Publish(Event{RunID: "r1", Agent: "mock", Type: TypeStart})
	h.Publish(Event{RunID: "r1", Agent: "mock", Type: TypeMessage, Text: "x"})

	loaded, _ := readEvents(dir, "r1")
	if len(loaded) != 2 || loaded[0].Seq != 1 || loaded[1].Seq != 2 {
		t.Fatalf("loaded = %v", loaded)
	}
}

func sseServer(h *Hub) *httptest.Server {
	mux := http.NewServeMux()
	mux.HandleFunc("/events/", func(w http.ResponseWriter, r *http.Request) {
		rest := strings.TrimPrefix(r.URL.Path, "/events/")
		if rest == "" {
			http.Error(w, "not found", http.StatusNotFound)
			return
		}
		h.ServeEvents(w, r, rest)
	})
	mux.HandleFunc("/events", func(w http.ResponseWriter, r *http.Request) {
		h.ServeEvents(w, r, "")
	})
	return httptest.NewServer(mux)
}

func sseGet(t *testing.T, url string, lastEventID string) *http.Response {
	t.Helper()
	req, err := http.NewRequest(http.MethodGet, url, nil)
	if err != nil {
		t.Fatal(err)
	}
	if lastEventID != "" {
		req.Header.Set("Last-Event-ID", lastEventID)
	}
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	return res
}

func readSSEFor(body io.ReadCloser, d time.Duration) string {
	defer body.Close()
	var buf strings.Builder
	done := make(chan struct{})
	go func() {
		io.Copy(&buf, body) //nolint:errcheck
		close(done)
	}()
	select {
	case <-done:
	case <-time.After(d):
	}
	return buf.String()
}

func collectSSE(body io.Reader) []Event {
	var out []Event
	scanner := bufio.NewScanner(body)
	var current strings.Builder
	for scanner.Scan() {
		line := scanner.Text()
		if line == "" {
			parts := strings.Split(current.String(), "\n")
			for _, p := range parts {
				if strings.HasPrefix(p, "data: ") {
					data := strings.TrimPrefix(p, "data: ")
					var e Event
					_ = json.Unmarshal([]byte(data), &e)
					if e.RunID != "" {
						out = append(out, e)
					}
					break
				}
			}
			current.Reset()
			continue
		}
		current.WriteString(line)
		current.WriteByte('\n')
	}
	return out
}

func collectSSEFor(body io.ReadCloser, d time.Duration) []Event {
	return collectSSE(strings.NewReader(readSSEFor(body, d)))
}

func TestHubReplayLastEventID(t *testing.T) {
	dir := t.TempDir()
	_ = appendJSONL(eventFile(dir, "r1"), Event{RunID: "r1", Seq: 1, Type: TypeStart, TS: time.Now().UTC().Format(time.RFC3339Nano)})
	_ = appendJSONL(eventFile(dir, "r1"), Event{RunID: "r1", Seq: 2, Type: TypeMessage, TS: time.Now().UTC().Format(time.RFC3339Nano), Text: "a"})
	_ = appendJSONL(eventFile(dir, "r1"), Event{RunID: "r1", Seq: 3, Type: TypeMessage, TS: time.Now().UTC().Format(time.RFC3339Nano), Text: "b"})

	h := NewHub(dir)
	defer h.Close()

	srv := sseServer(h)
	defer srv.Close()

	res := sseGet(t, srv.URL+"/events/r1", "1")
	got := collectSSEFor(res.Body, 100*time.Millisecond)
	if len(got) != 2 || got[0].Seq != 2 || got[1].Seq != 3 {
		t.Fatalf("got = %v", got)
	}
}

func TestHubLiveFanOut(t *testing.T) {
	dir := t.TempDir()
	h := NewHub(dir)
	defer h.Close()

	srv := sseServer(h)
	defer srv.Close()

	res1 := sseGet(t, srv.URL+"/events/r1", "")
	res2 := sseGet(t, srv.URL+"/events/r1", "")

	time.Sleep(50 * time.Millisecond)
	h.Publish(Event{RunID: "r1", Agent: "mock", Type: TypeMessage, Text: "live"})

	got1 := collectSSEFor(res1.Body, 150*time.Millisecond)
	got2 := collectSSEFor(res2.Body, 150*time.Millisecond)

	if len(got1) != 1 || got1[0].Text != "live" {
		t.Fatalf("subscriber1 = %v", got1)
	}
	if len(got2) != 1 || got2[0].Text != "live" {
		t.Fatalf("subscriber2 = %v", got2)
	}
}

func TestHubEventsRouteExtraction(t *testing.T) {
	dir := t.TempDir()
	h := NewHub(dir)
	defer h.Close()

	_ = appendJSONL(eventFile(dir, "run-1"), Event{RunID: "run-1", Seq: 1, Type: TypeStart, TS: time.Now().UTC().Format(time.RFC3339Nano)})

	srv := sseServer(h)
	defer srv.Close()

	res := sseGet(t, srv.URL+"/events/run-1", "")
	got := collectSSEFor(res.Body, 100*time.Millisecond)
	if len(got) != 1 || got[0].RunID != "run-1" {
		t.Fatalf("got = %v", got)
	}

	// Invalid path: /events/ should 404.
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/events/", nil).WithContext(context.Background())
	h.HandleEventsRoute(rec, req)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("empty run id = %d", rec.Code)
	}
}

func TestHubEmitRoute(t *testing.T) {
	dir := t.TempDir()
	h := NewHub(dir)
	defer h.Close()

	mux := http.NewServeMux()
	mux.HandleFunc("/emit/", func(w http.ResponseWriter, r *http.Request) {
		h.HandleEmitRoute(w, r)
	})
	srv := httptest.NewServer(mux)
	defer srv.Close()

	res, err := http.Post(srv.URL+"/emit/r2", "application/json", strings.NewReader(`{"type":"message","text":"hello"}`))
	if err != nil {
		t.Fatal(err)
	}
	if res.StatusCode != http.StatusAccepted {
		t.Fatalf("status = %d", res.StatusCode)
	}
	res.Body.Close()

	loaded, _ := readEvents(dir, "r2")
	if len(loaded) != 1 || loaded[0].Type != TypeMessage || loaded[0].Text != "hello" {
		t.Fatalf("loaded = %v", loaded)
	}
}

func TestHubHeartbeatPresent(t *testing.T) {
	dir := t.TempDir()
	h := NewHub(dir)
	h.HeartbeatInterval = 50 * time.Millisecond
	defer h.Close()

	srv := sseServer(h)
	defer srv.Close()

	res := sseGet(t, srv.URL+"/events", "")
	body := readSSEFor(res.Body, 200*time.Millisecond)
	if !strings.Contains(body, ": heartbeat") {
		t.Fatalf("no heartbeat in %s", body)
	}
}

func TestHubCloseReleasesSubscribers(t *testing.T) {
	dir := t.TempDir()
	h := NewHub(dir)

	srv := sseServer(h)
	defer srv.Close()

	res := sseGet(t, srv.URL+"/events", "")
	time.Sleep(20 * time.Millisecond)
	h.Close()

	readDone := make(chan error, 1)
	go func() {
		b := make([]byte, 1)
		_, err := res.Body.Read(b)
		readDone <- err
	}()
	select {
	case err := <-readDone:
		if err == nil {
			t.Fatal("expected handler to close body")
		}
	case <-time.After(time.Second):
		t.Fatal("subscriber did not close after Hub.Close")
	}
	res.Body.Close()
}

func TestHubFixtureReplayByteCompatible(t *testing.T) {
	dir := t.TempDir()
	lines := []string{
		`{"runId":"fix-1","agent":"mock","ts":"2026-10-13T09:00:00.000Z","seq":1,"type":"start"}`,
		`{"runId":"fix-1","agent":"mock","ts":"2026-10-13T09:00:01.000Z","seq":2,"type":"message","text":"hello"}`,
	}
	if err := os.MkdirAll(eventsDir(dir), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(eventFile(dir, "fix-1"), []byte(strings.Join(lines, "\n")+"\n"), 0o644); err != nil {
		t.Fatal(err)
	}

	h := NewHub(dir)
	defer h.Close()

	srv := sseServer(h)
	defer srv.Close()

	res := sseGet(t, srv.URL+"/events/fix-1", "")
	got := collectSSEFor(res.Body, 100*time.Millisecond)
	if len(got) != 2 || got[0].Seq != 1 || got[1].Text != "hello" {
		t.Fatalf("got = %v", got)
	}
}

func BenchmarkPublishNoSubscribers(b *testing.B) {
	dir := b.TempDir()
	h := NewHub(dir)
	defer h.Close()
	for i := 0; i < b.N; i++ {
		h.Publish(Event{RunID: "bench", Agent: "mock", Type: TypeMessage, Text: fmt.Sprintf("m%d", i)})
	}
}
