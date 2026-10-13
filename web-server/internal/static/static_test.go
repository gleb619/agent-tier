package static

import (
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func serve(t *testing.T, dir, target string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(http.MethodGet, target, nil)
	rec := httptest.NewRecorder()
	Handler(dir).ServeHTTP(rec, req)
	return rec
}

func makeStaticDir(t *testing.T) string {
	t.Helper()
	dir := t.TempDir()
	files := map[string]string{
		"index.html":                "<html>webui</html>",
		"app.js":                    "console.log(1)",
		"styles.css":                "body{}",
		"sw.js":                     "// service worker",
		"assets/index-aB3xYz99.js":  "console.log(2)",
		"assets/index-aB3xYz99.css": "body{}",
	}
	for name, content := range files {
		path := filepath.Join(dir, name)
		if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	return dir
}

func TestServesIndexAtRoot(t *testing.T) {
	dir := makeStaticDir(t)
	rec := serve(t, dir, "/")
	if rec.Code != 200 {
		t.Fatalf("GET / = %d", rec.Code)
	}
	if rec.Body.String() != "<html>webui</html>" {
		t.Fatalf("body = %q", rec.Body.String())
	}
	if ct := rec.Header().Get("Content-Type"); !strings.Contains(ct, "text/html") {
		t.Fatalf("content-type = %q", ct)
	}
}

func TestServesAssetsWithMime(t *testing.T) {
	dir := makeStaticDir(t)
	cases := map[string]string{
		"/app.js":                    "javascript",
		"/styles.css":                "text/css",
		"/assets/index-aB3xYz99.css": "text/css",
	}
	for target, want := range cases {
		rec := serve(t, dir, target)
		if rec.Code != 200 || !strings.Contains(rec.Header().Get("Content-Type"), want) {
			t.Fatalf("GET %s = %d %q", target, rec.Code, rec.Header().Get("Content-Type"))
		}
	}
}

func TestSPAFallback(t *testing.T) {
	dir := makeStaticDir(t)
	rec := serve(t, dir, "/runs/some-id")
	if rec.Code != 200 || rec.Body.String() != "<html>webui</html>" {
		t.Fatalf("SPA fallback = %d %q", rec.Code, rec.Body.String())
	}
}

func TestMissingIndexReturns404(t *testing.T) {
	rec := serve(t, t.TempDir(), "/anything")
	if rec.Code != 404 {
		t.Fatalf("no-index = %d, want 404", rec.Code)
	}
}

func TestRejectsPathTraversal(t *testing.T) {
	dir := makeStaticDir(t)
	secret := filepath.Join(filepath.Dir(dir), "secret.txt")
	if err := os.WriteFile(secret, []byte("secret"), 0o644); err != nil {
		t.Fatal(err)
	}
	defer os.Remove(secret)
	for _, target := range []string{"/..%2Fsecret.txt", "/../secret.txt", "/a/../../secret.txt"} {
		rec := serve(t, dir, target)
		// Node parity: cleaned traversal paths may fall back to index.html,
		// but the secret file outside the static dir must never leak.
		if strings.Contains(rec.Body.String(), "secret") {
			t.Fatalf("GET %s leaked secret: %q", target, rec.Body.String())
		}
	}
}

func TestETagAnd304(t *testing.T) {
	dir := makeStaticDir(t)
	first := serve(t, dir, "/app.js")
	etag := first.Header().Get("ETag")
	if etag == "" {
		t.Fatal("no ETag header")
	}
	req := httptest.NewRequest(http.MethodGet, "/app.js", nil)
	req.Header.Set("If-None-Match", etag)
	rec := httptest.NewRecorder()
	Handler(dir).ServeHTTP(rec, req)
	if rec.Code != 304 {
		t.Fatalf("If-None-Match = %d, want 304", rec.Code)
	}
}

func TestLastModifiedAnd304(t *testing.T) {
	dir := makeStaticDir(t)
	first := serve(t, dir, "/app.js")
	lm := first.Header().Get("Last-Modified")
	if lm == "" {
		t.Fatal("no Last-Modified header")
	}
	req := httptest.NewRequest(http.MethodGet, "/app.js", nil)
	req.Header.Set("If-Modified-Since", lm)
	rec := httptest.NewRecorder()
	Handler(dir).ServeHTTP(rec, req)
	if rec.Code != 304 {
		t.Fatalf("If-Modified-Since = %d, want 304", rec.Code)
	}
}

func TestCacheControl(t *testing.T) {
	dir := makeStaticDir(t)
	cases := map[string]string{
		"/":                         "no-cache",
		"/index.html":               "no-cache",
		"/sw.js":                    "no-cache",
		"/assets/index-aB3xYz99.js": "immutable",
		"/app.js":                   "no-cache",
	}
	for target, want := range cases {
		rec := serve(t, dir, target)
		cc := rec.Header().Get("Cache-Control")
		if want == "immutable" && !strings.Contains(cc, "immutable") {
			t.Fatalf("GET %s cache-control = %q, want immutable", target, cc)
		}
		if want == "no-cache" && !strings.Contains(cc, "no-cache") {
			t.Fatalf("GET %s cache-control = %q, want no-cache", target, cc)
		}
	}
}

func TestSPAFallbackForRoutePaths(t *testing.T) {
	dir := makeStaticDir(t)
	cases := []string{"/", "/new", "/settings", "/runs/some-id", "/deeply/nested/path"}
	for _, target := range cases {
		rec := serve(t, dir, target)
		if rec.Code != 200 || rec.Body.String() != "<html>webui</html>" {
			t.Fatalf("SPA fallback for %s = %d %q", target, rec.Code, rec.Body.String())
		}
	}
}
