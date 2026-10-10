package executor

import (
	"fmt"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"time"

	"mock-agent/internal/spec"
)

func TestSSE_CountEvents(t *testing.T) {
	var sent int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/event-stream")
		flusher, ok := w.(http.Flusher)
		if !ok {
			t.Fatal("no flusher")
		}
		for i := 0; i < 5; i++ {
			fmt.Fprintf(w, "data: msg-%d\n\n", i)
			flusher.Flush()
			atomic.AddInt32(&sent, 1)
			time.Sleep(10 * time.Millisecond)
		}
	}))
	defer srv.Close()

	step := spec.Step{Kind: "sse", Raw: []byte(`{"kind":"sse","url":"` + srv.URL + `","events":3,"timeout_ms":2000}`)}
	if err := registry["sse"](step, nil); err != nil {
		t.Fatal(err)
	}
	if atomic.LoadInt32(&sent) < 3 {
		t.Fatalf("expected >=3 events, got %d", sent)
	}
}
