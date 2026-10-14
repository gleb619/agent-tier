package daemon

import (
	"bytes"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"

	"github.com/fsnotify/fsnotify"
)

// Hot-cache kinds, which double as the daemon socket commands serving them.
const (
	CacheRuns   = "runs"
	CacheState  = "state"
	CacheHealth = "health"
	CacheConfig = "config"
	CacheBins   = "bins"
	// CacheStatsCmd serves read/miss/invalidation counters for `at daemon cache`.
	CacheStatsCmd = "cache-stats"
)

// cacheEntry is one parsed document (or one bin resolution) plus the evidence
// needed to decide whether it may still be served.
type cacheEntry struct {
	value any
	// sig fingerprints the sources' (size, mtime). fsnotify drives normal
	// invalidation; this is the safety net for events the kernel coalesces or
	// the queue drops, so a hit is never served over changed bytes.
	sig string
	// sources are paths whose fsnotify events dirty this entry: the state file
	// and its directory for file kinds, the candidate directories for bins.
	sources []string
	// watchable is false when a source directory could not be watched (it does
	// exist ⇒ nothing can invalidate the entry), so it is never stored.
	watchable bool
	dirty     bool
}

// HotCache keeps the parsed state the CLI re-reads on every invocation: the
// runs index, state.json (scheduler + agent health), config.json, and agent bin
// resolution. `at status` and the scheduler read through it over the daemon
// socket (T35); writes stay with the existing locked TS stores (T36).
type HotCache struct {
	mu       sync.Mutex
	watcher  *fsnotify.Watcher
	watched  map[string]bool
	entries  map[string]*cacheEntry
	stateDir string
	stats    CacheStats
}

// CacheStats counts what the caches actually saved.
type CacheStats struct {
	Hits          int      `json:"hits"`
	Misses        int      `json:"misses"`
	Invalidations int      `json:"invalidations"`
	Entries       int      `json:"entries"`
	Watched       []string `json:"watched"`
}

func newHotCache(stateDir string) (*HotCache, error) {
	w, err := fsnotify.NewWatcher()
	if err != nil {
		return nil, fmt.Errorf("new fsnotify watcher: %w", err)
	}
	c := &HotCache{
		watcher:  w,
		watched:  map[string]bool{},
		entries:  map[string]*cacheEntry{},
		stateDir: stateDir,
	}
	c.watchLocked(stateDir)
	go c.eventLoop()
	return c, nil
}

// Close releases the fsnotify fd. Safe on a nil receiver or closed watcher.
func (c *HotCache) Close() error {
	if c == nil || c.watcher == nil {
		return nil
	}
	return c.watcher.Close()
}

// StateDir is the directory whose files the caches mirror.
func (c *HotCache) StateDir() string { return c.stateDir }

func (c *HotCache) Stats() CacheStats {
	c.mu.Lock()
	defer c.mu.Unlock()
	watched := make([]string, 0, len(c.watched))
	for d := range c.watched {
		watched = append(watched, d)
	}
	sort.Strings(watched)
	out := c.stats
	out.Entries = len(c.entries)
	out.Watched = watched
	return out
}

// watchLocked adds dir to the watcher if it is not already watched. Callers
// hold c.mu. Returns false when the dir cannot be watched (usually missing).
func (c *HotCache) watchLocked(dir string) bool {
	if dir == "" || c.watcher == nil {
		return false
	}
	if c.watched[dir] {
		return true
	}
	if err := c.watcher.Add(dir); err != nil {
		return false
	}
	c.watched[dir] = true
	return true
}

func (c *HotCache) eventLoop() {
	for {
		select {
		case ev, ok := <-c.watcher.Events:
			if !ok {
				return
			}
			c.markDirty(ev.Name)
		case _, ok := <-c.watcher.Errors:
			if !ok {
				return
			}
		}
	}
}

// markDirty flags every entry that reads from path (exact file or its dir).
func (c *HotCache) markDirty(path string) {
	c.mu.Lock()
	defer c.mu.Unlock()
	for _, e := range c.entries {
		for _, s := range e.sources {
			if s == path || filepath.Dir(s) == path || filepath.Dir(path) == s {
				if !e.dirty {
					e.dirty = true
					c.stats.Invalidations++
				}
				break
			}
		}
	}
}

// get returns the current value for kind, reloading only when the cache is
// dirty or its sources changed. The bool reports a pure cache hit.
func (c *HotCache) get(kind, dir string, params map[string]any) (any, bool, error) {
	switch kind {
	case CacheRuns:
		return c.readFileEntry(kind, c.resolveDir(dir), "runs.jsonl", parseRunsFile)
	case CacheState:
		return c.readFileEntry(kind, c.resolveDir(dir), "state.json", parseJSONMap)
	case CacheHealth:
		return c.readFileEntry(kind, c.resolveDir(dir), "state.json", parseHealthView)
	case CacheConfig:
		return c.configEntry()
	case CacheBins:
		return c.binsEntry(params)
	default:
		return nil, false, fmt.Errorf("unknown cache kind %q", kind)
	}
}

func (c *HotCache) resolveDir(dir string) string {
	if dir != "" {
		return dir
	}
	return c.stateDir
}

// readFileEntry caches one parsed document from dir/name.
func (c *HotCache) readFileEntry(kind, dir, name string, parse func([]byte) (any, error)) (any, bool, error) {
	file := filepath.Join(dir, name)
	sig, err := pathSig(file)
	if err != nil {
		return nil, false, err
	}
	key := kind + "|" + file

	c.mu.Lock()
	defer c.mu.Unlock()
	if e := c.entries[key]; e != nil && !e.dirty && e.sig == sig && e.watchable {
		c.stats.Hits++
		return e.value, true, nil
	}

	var raw []byte
	if buf, err := os.ReadFile(file); err == nil {
		raw = buf
	} else if !os.IsNotExist(err) {
		return nil, false, fmt.Errorf("read %s: %w", file, err)
	}
	val, err := parse(raw)
	if err != nil {
		// Malformed state: report it and keep nothing cached, so the client
		// falls back to its own (tolerant) reader instead of a poisoned entry.
		return nil, false, fmt.Errorf("parse %s: %w", file, err)
	}

	watchable := c.watchLocked(dir)
	c.entries[key] = &cacheEntry{
		value:     val,
		sig:       sig,
		sources:   []string{file, dir},
		watchable: watchable,
	}
	c.stats.Misses++
	return val, false, nil
}

// configEntry serves the raw config.json plus its HMAC file. Integrity
// verification deliberately stays in src/config.ts (loadConfig) — the daemon
// caches bytes, it does not vouch for them.
func (c *HotCache) configEntry() (any, bool, error) {
	dir := configDir()
	file := filepath.Join(dir, "config.json")
	hmacFile := filepath.Join(dir, "config.json.hmac")

	sig, err := pathSig(file)
	if err != nil {
		return nil, false, err
	}
	hmacSig, err := pathSig(hmacFile)
	if err != nil {
		return nil, false, err
	}
	sig = sig + "/" + hmacSig
	key := CacheConfig + "|" + file

	c.mu.Lock()
	defer c.mu.Unlock()
	if e := c.entries[key]; e != nil && !e.dirty && e.sig == sig && e.watchable {
		c.stats.Hits++
		return e.value, true, nil
	}

	out := map[string]any{"text": "", "hmac": ""}
	if raw, err := os.ReadFile(file); err == nil {
		out["text"] = string(raw)
	} else if !os.IsNotExist(err) {
		return nil, false, fmt.Errorf("read %s: %w", file, err)
	}
	if raw, err := os.ReadFile(hmacFile); err == nil {
		out["hmac"] = strings.TrimSpace(string(raw))
	} else if !os.IsNotExist(err) {
		return nil, false, fmt.Errorf("read %s: %w", hmacFile, err)
	}

	c.entries[key] = &cacheEntry{
		value:     out,
		sig:       sig,
		sources:   []string{file, hmacFile, dir},
		watchable: c.watchLocked(dir),
	}
	c.stats.Misses++
	return out, false, nil
}

// binsEntry resolves every agent name to the first candidate path that exists,
// one cache entry per name so a single unwatchable candidate (its parent dir is
// missing ⇒ nothing can invalidate it) only costs that name a hit.
func (c *HotCache) binsEntry(params map[string]any) (any, bool, error) {
	cands, err := parseCandidates(params["candidates"])
	if err != nil {
		return nil, false, err
	}

	out := map[string]any{}
	allHit := true
	for _, name := range cands.names {
		val, cached, err := c.binEntry(name, cands.byName[name])
		if err != nil {
			return nil, false, err
		}
		out[name] = val
		if !cached {
			allHit = false
		}
	}
	return out, allHit, nil
}

func (c *HotCache) binEntry(name string, paths []string) (any, bool, error) {
	dirs := parentDirs(paths)
	parts := make([]string, 0, len(dirs))
	for _, d := range dirs {
		s, err := pathSig(d)
		if err != nil {
			return nil, false, err
		}
		parts = append(parts, s)
	}
	sig := strings.Join(parts, ";")
	key := CacheBins + "|" + name + "|" + strings.Join(paths, ",")

	c.mu.Lock()
	defer c.mu.Unlock()
	if e := c.entries[key]; e != nil && !e.dirty && e.sig == sig && e.watchable {
		c.stats.Hits++
		return e.value, true, nil
	}

	var val any
	if p := firstExisting(paths); p != "" {
		val = p
	}
	watchable := true
	for _, d := range dirs {
		if !c.watchLocked(d) {
			watchable = false
		}
	}
	if watchable {
		c.entries[key] = &cacheEntry{value: val, sig: sig, sources: dirs, watchable: true}
	} else {
		delete(c.entries, key)
	}
	c.stats.Misses++
	return val, false, nil
}

// --- payloads ------------------------------------------------------------

// parseRunsFile mirrors readJsonl in src/run-store.ts: newline-separated
// records, with the legacy single-line {"runs":[…]} index flattened.
func parseRunsFile(raw []byte) (any, error) {
	out := []any{}
	if len(bytes.TrimSpace(raw)) == 0 {
		return out, nil
	}
	lines := []string{}
	for _, l := range strings.Split(string(raw), "\n") {
		if l = strings.TrimSpace(l); l != "" {
			lines = append(lines, l)
		}
	}
	if len(lines) == 1 {
		var idx map[string]any
		if err := json.Unmarshal([]byte(lines[0]), &idx); err == nil {
			if runs, ok := idx["runs"].([]any); ok {
				return runs, nil
			}
		}
	}
	for _, l := range lines {
		var v any
		if err := json.Unmarshal([]byte(l), &v); err != nil {
			return nil, err
		}
		out = append(out, v)
	}
	return out, nil
}

func parseJSONMap(raw []byte) (any, error) {
	out := map[string]any{}
	if len(bytes.TrimSpace(raw)) == 0 {
		return out, nil
	}
	if err := json.Unmarshal(raw, &out); err != nil {
		return nil, err
	}
	return out, nil
}

// parseHealthView exposes only state.json's `agents` block, the same shape
// src/health.ts loadHealth returns.
func parseHealthView(raw []byte) (any, error) {
	v, err := parseJSONMap(raw)
	if err != nil {
		return nil, err
	}
	full, _ := v.(map[string]any)
	agents, ok := full["agents"].(map[string]any)
	if !ok {
		agents = map[string]any{}
	}
	return map[string]any{"agents": agents}, nil
}

// --- helpers -------------------------------------------------------------

// pathSig fingerprints a path for staleness checks. Missing paths sign as
// "absent" so creation and deletion both move the signature.
func pathSig(p string) (string, error) {
	st, err := os.Stat(p)
	if err != nil {
		if os.IsNotExist(err) {
			return "absent", nil
		}
		return "", err
	}
	if st.IsDir() {
		return fmt.Sprintf("dir:%d", st.ModTime().UnixNano()), nil
	}
	return fmt.Sprintf("%d:%d", st.Size(), st.ModTime().UnixNano()), nil
}

// configDir mirrors src/config.ts: AT_CONFIG_DIR, else ~/.at.
func configDir() string {
	if d := os.Getenv("AT_CONFIG_DIR"); d != "" {
		return d
	}
	home, err := os.UserHomeDir()
	if err != nil {
		return filepath.Join(os.TempDir(), ".at")
	}
	return filepath.Join(home, ".at")
}

type candidateSet struct {
	names  []string
	byName map[string][]string
}

func parseCandidates(v any) (*candidateSet, error) {
	raw, ok := v.(map[string]any)
	if !ok {
		return nil, fmt.Errorf(`'candidates' must be an object of {agent: [paths]}`)
	}
	out := &candidateSet{byName: map[string][]string{}}
	names := make([]string, 0, len(raw))
	for name, list := range raw {
		if name == "" {
			return nil, fmt.Errorf("candidate key must be a non-empty agent name")
		}
		items, ok := list.([]any)
		if !ok {
			return nil, fmt.Errorf("candidates for %q must be an array of paths", name)
		}
		paths := make([]string, 0, len(items))
		for _, it := range items {
			p, ok := it.(string)
			if !ok || p == "" {
				return nil, fmt.Errorf("candidates for %q must be non-empty paths", name)
			}
			paths = append(paths, p)
		}
		out.byName[name] = paths
		names = append(names, name)
	}
	sort.Strings(names)
	out.names = names
	return out, nil
}

func parentDirs(paths []string) []string {
	seen := map[string]bool{}
	out := []string{}
	for _, p := range paths {
		d := filepath.Dir(p)
		if !seen[d] {
			seen[d] = true
			out = append(out, d)
		}
	}
	sort.Strings(out)
	return out
}

func firstExisting(paths []string) string {
	for _, p := range paths {
		if st, err := os.Stat(p); err == nil && !st.IsDir() {
			return p
		}
	}
	return ""
}
