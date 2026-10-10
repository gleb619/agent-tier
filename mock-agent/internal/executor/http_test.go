package executor

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"mock-agent/internal/spec"
)

func TestHttp_GET_2xx(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != "GET" {
			t.Errorf("want GET got %s", r.Method)
		}
		w.WriteHeader(200)
	}))
	defer srv.Close()

	step := spec.Step{Kind: "http", Raw: []byte(`{"kind":"http","method":"GET","url":"` + srv.URL + `","expect":[200]}`)}
	if err := registry["http"](step, nil); err != nil {
		t.Fatal(err)
	}
}

func TestHttp_UnexpectedStatus(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(500)
	}))
	defer srv.Close()

	step := spec.Step{Kind: "http", Raw: []byte(`{"kind":"http","method":"GET","url":"` + srv.URL + `","expect":[200]}`)}
	if err := registry["http"](step, nil); err == nil {
		t.Fatal("expected error")
	}
}
