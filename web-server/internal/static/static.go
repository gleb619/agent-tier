// Package static serves the built WebUI (src/webui/dist) with SPA fallback:
// unknown, extensionless or directory paths render index.html. Path
// traversal outside the static dir is rejected; responses carry ETag,
// Last-Modified and Cache-Control (immutable for hashed assets, no-cache for
// index.html/sw.js). Text assets are served precompressed (.br/.gz siblings
// generated at build time) when the client advertises support.
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

		hasBrotli := fileExists(filePath + ".br")
		hasGzip := fileExists(filePath + ".gz")
		encoding := negotiateEncoding(r.Header.Get("Accept-Encoding"), hasBrotli, hasGzip)
		suffix := map[string]string{"br": ".br", "gzip": ".gz"}[encoding]
		servePath := filePath + suffix

		data, err := os.ReadFile(servePath)
		if err != nil {
			jsonError(w, http.StatusNotFound, "not found")
			return
		}

		sum := sha256.Sum256(data)
		etag := `"` + hex.EncodeToString(sum[:]) + `"`
		w.Header().Set("ETag", etag)
		w.Header().Set("Cache-Control", cacheControl(rel, filePath))
		if encoding != "" || hasBrotli || hasGzip {
			// Proxies must not cache the encoded variant under a key that
			// ignores Accept-Encoding.
			w.Header().Set("Vary", "Accept-Encoding")
		}
		if path.Base(rel) == "sw.js" {
			w.Header().Set("Service-Worker-Allowed", "/")
		}
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
		if encoding != "" {
			w.Header().Set("Content-Encoding", encoding)
		}
		w.Header().Set("Content-Length", strconv.Itoa(len(data)))
		if r.Method == http.MethodHead {
			w.WriteHeader(http.StatusOK)
			return
		}
		w.Write(data) //nolint:errcheck // client gone mid-write is not actionable
	})
}

func fileExists(file string) bool {
	info, err := os.Stat(file)
	return err == nil && !info.IsDir()
}

// negotiateEncoding picks the content encoding with the highest q-value the
// client accepts among the variants present on disk; br wins ties. Empty
// string means the identity (uncompressed) representation.
func negotiateEncoding(header string, hasBrotli, hasGzip bool) string {
	best := ""
	bestQ := 0.0
	for _, part := range strings.Split(header, ",") {
		part = strings.TrimSpace(part)
		if part == "" {
			continue
		}
		name, q, ok := parseEncodingPart(part)
		if !ok || q <= 0 {
			continue
		}
		avail := (name == "br" && hasBrotli) || (name == "gzip" && hasGzip)
		if !avail {
			continue
		}
		if q > bestQ || (q == bestQ && best == "gzip" && name == "br") {
			best, bestQ = name, q
		}
	}
	return best
}

// parseEncodingPart splits "gzip;q=0.5" into ("gzip", 0.5); q defaults to 1.
func parseEncodingPart(part string) (string, float64, bool) {
	pieces := strings.Split(part, ";")
	name := strings.TrimSpace(pieces[0])
	if name != "br" && name != "gzip" {
		return "", 0, false
	}
	q := 1.0
	for _, param := range pieces[1:] {
		param = strings.TrimSpace(param)
		if !strings.HasPrefix(param, "q=") {
			continue
		}
		parsed, err := strconv.ParseFloat(strings.TrimPrefix(param, "q="), 64)
		if err != nil {
			return "", 0, false
		}
		q = parsed
	}
	return name, q, true
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
