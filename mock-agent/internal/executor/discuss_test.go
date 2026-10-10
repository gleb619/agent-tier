package executor

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"mock-agent/internal/spec"
)

func TestDiscuss_Acks(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var body map[string]any
		_ = json.NewDecoder(r.Body).Decode(&body)
		if body["question"] != "ready" {
			t.Errorf("missing question: %v", body)
		}
		time.Sleep(50 * time.Millisecond)
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]string{"answer": "yes"})
	}))
	defer srv.Close()

	t.Setenv("AT_DISCUSS_URL", srv.URL)
	step := spec.Step{Kind: "discuss", Raw: []byte(`{"kind":"discuss","ask":"ops","question":"ready","answer_after_ms":2000}`)}
	if err := registry["discuss"](step, nil); err != nil {
		t.Fatal(err)
	}
}

func TestDiscuss_Timeout(t *testing.T) {
	// Unroutable port → immediate connect failure counts as a fail, not a hang;
	// assert the handler surfaces an error rather than panicking.
	t.Setenv("AT_DISCUSS_URL", "http://127.0.0.1:1")
	step := spec.Step{Kind: "discuss", Raw: []byte(`{"kind":"discuss","ask":"ops","question":"x","answer_after_ms":50}`)}
	if err := registry["discuss"](step, nil); err == nil {
		t.Fatal("expected error")
	}
}
