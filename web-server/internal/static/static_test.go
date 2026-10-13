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

// makeCompressedDir is makeStaticDir plus .br/.gz siblings for app.js.
func makeCompressedDir(t *testing.T) string {
	t.Helper()
	dir := makeStaticDir(t)
	js := []byte("console.log(1)")
	for _, suffix := range []string{".br", ".gz"} {
		if err := os.WriteFile(filepath.Join(dir, "app.js"+suffix), append([]byte(suffix+":"), js...), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	return dir
}

func serveEncoded(t *testing.T, dir, target, acceptEncoding string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(http.MethodGet, target, nil)
	if acceptEncoding != "" {
		req.Header.Set("Accept-Encoding", acceptEncoding)
	}
	rec := httptest.NewRecorder()
	Handler(dir).ServeHTTP(rec, req)
	return rec
}

func TestServesPrecompressedBrotli(t *testing.T) {
	dir := makeCompressedDir(t)
	rec := serveEncoded(t, dir, "/app.js", "gzip, deflate, br")
	if rec.Code != 200 {
		t.Fatalf("GET /app.js = %d", rec.Code)
	}
	if got := rec.Header().Get("Content-Encoding"); got != "br" {
		t.Fatalf("Content-Encoding = %q, want br", got)
	}
	if got := rec.Header().Get("Vary"); !strings.Contains(got, "Accept-Encoding") {
		t.Fatalf("Vary = %q, want Accept-Encoding", got)
	}
	if got := rec.Header().Get("Content-Type"); !strings.Contains(got, "javascript") {
		t.Fatalf("Content-Type = %q, want javascript", got)
	}
	if rec.Body.String() != ".br:console.log(1)" {
		t.Fatalf("body = %q, want precompressed br bytes", rec.Body.String())
	}
}

func TestServesPrecompressedGzipWhenNoBrotli(t *testing.T) {
	dir := makeCompressedDir(t)
	rec := serveEncoded(t, dir, "/app.js", "gzip, deflate")
	if got := rec.Header().Get("Content-Encoding"); got != "gzip" {
		t.Fatalf("Content-Encoding = %q, want gzip", got)
	}
	if rec.Body.String() != ".gz:console.log(1)" {
		t.Fatalf("body = %q, want precompressed gzip bytes", rec.Body.String())
	}
}

func TestServesIdentityWithoutAcceptEncoding(t *testing.T) {
	dir := makeCompressedDir(t)
	rec := serveEncoded(t, dir, "/app.js", "")
	if got := rec.Header().Get("Content-Encoding"); got != "" {
		t.Fatalf("Content-Encoding = %q, want none", got)
	}
	if rec.Body.String() != "console.log(1)" {
		t.Fatalf("body = %q, want original bytes", rec.Body.String())
	}
}

func TestSkipsEncodingRejectedWithQ0(t *testing.T) {
	dir := makeCompressedDir(t)
	rec := serveEncoded(t, dir, "/app.js", "br;q=0, gzip;q=0")
	if got := rec.Header().Get("Content-Encoding"); got != "" {
		t.Fatalf("Content-Encoding = %q, want none when q=0", got)
	}
	// Unlisted codings are not acceptable (RFC 9110 §12.5.3): br rejected
	// alone leaves only the identity representation.
	rec = serveEncoded(t, dir, "/app.js", "br;q=0")
	if got := rec.Header().Get("Content-Encoding"); got != "" {
		t.Fatalf("Content-Encoding = %q, want none when only br is listed and rejected", got)
	}
	if rec.Body.String() != "console.log(1)" {
		t.Fatalf("body = %q, want original bytes", rec.Body.String())
	}
}

func TestNoVariantsMeansNoContentEncodingOrVary(t *testing.T) {
	dir := makeStaticDir(t)
	rec := serveEncoded(t, dir, "/styles.css", "br, gzip")
	if got := rec.Header().Get("Content-Encoding"); got != "" {
		t.Fatalf("Content-Encoding = %q, want none (no variants on disk)", got)
	}
	if got := rec.Header().Get("Vary"); strings.Contains(got, "Accept-Encoding") {
		t.Fatalf("Vary = %q, want no Accept-Encoding without variants", got)
	}
}

func TestPrecompressedETagAnd304(t *testing.T) {
	dir := makeCompressedDir(t)
	first := serveEncoded(t, dir, "/app.js", "br")
	etag := first.Header().Get("ETag")
	if etag == "" {
		t.Fatal("no ETag header")
	}
	req := httptest.NewRequest(http.MethodGet, "/app.js", nil)
	req.Header.Set("Accept-Encoding", "br")
	req.Header.Set("If-None-Match", etag)
	rec := httptest.NewRecorder()
	Handler(dir).ServeHTTP(rec, req)
	if rec.Code != 304 {
		t.Fatalf("If-None-Match = %d, want 304", rec.Code)
	}
}

func TestServesSwWithServiceWorkerAllowedHeader(t *testing.T) {
	dir := makeStaticDir(t)
	rec := serve(t, dir, "/sw.js")
	if rec.Code != 200 {
		t.Fatalf("GET /sw.js = %d, want 200", rec.Code)
	}
	if got := rec.Header().Get("Service-Worker-Allowed"); got != "/" {
		t.Fatalf("Service-Worker-Allowed = %q, want /", got)
	}
	if got := rec.Header().Get("Cache-Control"); !strings.Contains(got, "no-cache") {
		t.Fatalf("GET /sw.js cache-control = %q, want no-cache", got)
	}
}
