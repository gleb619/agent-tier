// Package static serves the built WebUI (src/webui/dist) with SPA fallback:
// unknown, extensionless or directory paths render index.html. Path
// traversal outside the static dir is rejected; responses carry ETag,
// Last-Modified and Cache-Control (immutable for hashed assets, no-cache for
// index.html/sw.js).
package static

import (
	"crypto/sha256"
	"encoding/hex"
	"net/http"
	"os"
	"path"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"time"
)

var mimeTypes = map[string]string{
	".html":        "text/html; charset=utf-8",
	".js":          "text/javascript; charset=utf-8",
	".css":         "text/css; charset=utf-8",
	".json":        "application/json",
	".svg":         "image/svg+xml",
	".png":         "image/png",
	".ico":         "image/x-icon",
	".map":         "application/json",
	".txt":         "text/plain; charset=utf-8",
	".wasm":        "application/wasm",
	".webmanifest": "application/manifest+json",
	".woff":        "font/woff",
	".woff2":       "font/woff2",
}

// Vite content hashes are 8 base64url chars between dashes: name-aB3xYz99.js.
var hashedAssetRe = regexp.MustCompile(`-[0-9A-Za-z_-]{8}\.[0-9A-Za-z]+$`)

func contentType(file string) string {
	return mimeTypes[strings.ToLower(filepath.Ext(file))]
}

// cacheControl: immutable for fingerprinted assets (assets/ dir or hashed
// basename), no-cache for everything else — index.html and sw.js must always
// revalidate so deploys land immediately.
func cacheControl(urlPath, file string) string {
	if hashedAssetRe.MatchString(path.Base(urlPath)) || strings.Contains("/"+path.Clean(urlPath), "/assets/") {
		return "public, max-age=31536000, immutable"
	}
	return "no-cache"
}

// Handler returns an http.Handler serving dir. When dir (or its index.html)
// is missing, every request 404s.
func Handler(dir string) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet && r.Method != http.MethodHead {
			jsonError(w, http.StatusNotFound, "not found")
			return
		}

		rel := path.Clean("/" + r.URL.Path) // forces root-relative, collapses ..
		full := filepath.Join(dir, filepath.FromSlash(rel))
		if full != filepath.Clean(dir) && !strings.HasPrefix(full, filepath.Clean(dir)+string(filepath.Separator)) {
			jsonError(w, http.StatusForbidden, "forbidden")
			return
		}

		filePath := full
		if info, err := os.Stat(full); err != nil || info.IsDir() {
			// SPA fallback: unknown paths render the app shell.
			filePath = filepath.Join(dir, "index.html")
			if _, err := os.Stat(filePath); err != nil {
				jsonError(w, http.StatusNotFound, "not found")
				return
			}
		}

		data, err := os.ReadFile(filePath)
		if err != nil {
			jsonError(w, http.StatusNotFound, "not found")
			return
		}

		sum := sha256.Sum256(data)
		etag := `"` + hex.EncodeToString(sum[:]) + `"`
		w.Header().Set("ETag", etag)
		w.Header().Set("Cache-Control", cacheControl(rel, filePath))
		if info, err := os.Stat(filePath); err == nil {
			w.Header().Set("Last-Modified", info.ModTime().UTC().Format(http.TimeFormat))
		}

		if matchEtag(r.Header.Get("If-None-Match"), etag) || notModifiedSince(r, filePath) {
			w.WriteHeader(http.StatusNotModified)
			return
		}

		ct := contentType(filePath)
		if ct == "" {
			ct = "application/octet-stream"
		}
		w.Header().Set("Content-Type", ct)
		w.Header().Set("Content-Length", strconv.Itoa(len(data)))
		if r.Method == http.MethodHead {
			w.WriteHeader(http.StatusOK)
			return
		}
		w.Write(data) //nolint:errcheck // client gone mid-write is not actionable
	})
}

func matchEtag(header, etag string) bool {
	if header == "" {
		return false
	}
	for _, candidate := range strings.Split(header, ",") {
		candidate = strings.TrimSpace(candidate)
		candidate = strings.TrimPrefix(candidate, "W/")
		if candidate == etag || candidate == "*" {
			return true
		}
	}
	return false
}

func notModifiedSince(r *http.Request, file string) bool {
	header := r.Header.Get("If-Modified-Since")
	if header == "" {
		return false
	}
	since, err := http.ParseTime(header)
	if err != nil {
		return false
	}
	info, err := os.Stat(file)
	if err != nil {
		return false
	}
	return !info.ModTime().UTC().Truncate(time.Second).After(since)
}

func jsonError(w http.ResponseWriter, status int, message string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	w.Write([]byte(`{"error":` + strconv.Quote(message) + `}`)) //nolint:errcheck // best-effort error body
}
