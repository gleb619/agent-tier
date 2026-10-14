package daemon

import (
	"encoding/json"
	"net"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func mustWrite(t *testing.T, path, content string, mode os.FileMode) {
	t.Helper()
	if err := os.WriteFile(path, []byte(content), mode); err != nil {
		t.Fatalf("write %s: %v", path, err)
	}
}

// waitFor polls fn until it reports done, with a hard deadline — fsnotify
// delivery is asynchronous, so cache tests must not assume an event landed.
func waitFor(t *testing.T, what string, fn func() (bool, error)) {
	t.Helper()
	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		ok, err := fn()
		if err != nil {
			t.Fatalf("%s: %v", what, err)
		}
		if ok {
			return
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatalf("%s: timed out", what)
}

func TestHotCacheRunsIndexHit(t *testing.T) {
	dir := t.TempDir()
	mustWrite(t, filepath.Join(dir, "runs.jsonl"),
		`{"runId":"r1","agent":"qwen","status":"done"}`+"\n", 0o600)

	c, err := newHotCache(dir)
	if err != nil {
		t.Fatalf("newHotCache: %v", err)
	}
	defer c.Close()

	val, cached, err := c.get(CacheRuns, dir, nil)
	if err != nil {
		t.Fatalf("get runs: %v", err)
	}
	if cached {
		t.Errorf("first read must not be a cache hit")
	}
	runs, ok := val.([]any)
	if !ok || len(runs) != 1 {
		t.Fatalf("runs payload = %#v", val)
	}
	first := runs[0].(map[string]any)
	if first["runId"] != "r1" || first["agent"] != "qwen" {
		t.Errorf("run fields = %#v", first)
	}

	if _, cached, err = c.get(CacheRuns, dir, nil); err != nil || !cached {
		t.Errorf("second read should hit (cached=%v err=%v)", cached, err)
	}
	st := c.Stats()
	if st.Hits != 1 || st.Misses != 1 {
		t.Errorf("stats = %+v, want 1 hit / 1 miss", st)
	}
}

func TestHotCacheRunsIndexLegacySingleObject(t *testing.T) {
	dir := t.TempDir()
	mustWrite(t, filepath.Join(dir, "runs.jsonl"),
		`{"runs":[{"runId":"a"},{"runId":"b"}]}`+"\n", 0o600)

	c, err := newHotCache(dir)
	if err != nil {
		t.Fatalf("newHotCache: %v", err)
	}
	defer c.Close()

	val, _, err := c.get(CacheRuns, dir, nil)
	if err != nil {
		t.Fatalf("get runs: %v", err)
	}
	runs, ok := val.([]any)
	if !ok || len(runs) != 2 {
		t.Fatalf("legacy index not flattened: %#v", val)
	}
}

func TestHotCacheRunsIndexMissingFileIsEmpty(t *testing.T) {
	dir := t.TempDir()
	c, err := newHotCache(dir)
	if err != nil {
		t.Fatalf("newHotCache: %v", err)
	}
	defer c.Close()

	val, _, err := c.get(CacheRuns, dir, nil)
	if err != nil {
		t.Fatalf("missing runs.jsonl must read as empty, got: %v", err)
	}
	if runs, ok := val.([]any); !ok || len(runs) != 0 {
		t.Fatalf("payload = %#v", val)
	}
}

func TestHotCacheMalformedFileIsErrorNotCached(t *testing.T) {
	dir := t.TempDir()
	mustWrite(t, filepath.Join(dir, "runs.jsonl"), "not json at all\n", 0o600)
	c, err := newHotCache(dir)
	if err != nil {
		t.Fatalf("newHotCache: %v", err)
	}
	defer c.Close()

	if _, _, err := c.get(CacheRuns, dir, nil); err == nil {
		t.Fatalf("expected parse error for malformed runs.jsonl")
	}
	if st := c.Stats(); st.Entries != 0 {
		t.Errorf("malformed payload must not be cached, entries=%d", st.Entries)
	}
}

func TestHotCacheInvalidatedByFileWrite(t *testing.T) {
	dir := t.TempDir()
	runs := filepath.Join(dir, "runs.jsonl")
	mustWrite(t, runs, `{"runId":"r1"}`+"\n", 0o600)

	c, err := newHotCache(dir)
	if err != nil {
		t.Fatalf("newHotCache: %v", err)
	}
	defer c.Close()
	if _, _, err := c.get(CacheRuns, dir, nil); err != nil {
		t.Fatalf("seed read: %v", err)
	}

	mustWrite(t, runs, `{"runId":"r1"}`+"\n"+`{"runId":"r2"}`+"\n", 0o600)

	// The fsnotify event marks the entry dirty; the next read must reload.
	waitFor(t, "wait for invalidation event", func() (bool, error) {
		return c.Stats().Invalidations > 0, nil
	})
	val, cached, err := c.get(CacheRuns, dir, nil)
	if err != nil {
		t.Fatalf("read after write: %v", err)
	}
	if cached {
		t.Errorf("read after invalidation must miss the cache")
	}
	if got := val.([]any); len(got) != 2 {
		t.Errorf("runs after write = %#v, want 2 entries", got)
	}
}

func TestHotCacheStatSignatureCatchesMissedEvents(t *testing.T) {
	dir := t.TempDir()
	c, err := newHotCache(dir)
	if err != nil {
		t.Fatalf("newHotCache: %v", err)
	}
	defer c.Close()
	if _, _, err := c.get(CacheState, dir, nil); err != nil {
		t.Fatalf("seed read: %v", err)
	}
	mustWrite(t, filepath.Join(dir, "state.json"), `{"runs":{"maxEntries":7}}`, 0o600)
	// Forget every event the watcher may or may not have delivered: the entry
	// must still reload because the (size, mtime) signature changed.
	c.mu.Lock()
	for _, e := range c.entries {
		e.dirty = false
	}
	c.mu.Unlock()

	val, cached, err := c.get(CacheState, dir, nil)
	if err != nil {
		t.Fatalf("reread: %v", err)
	}
	if cached {
		t.Errorf("signature change must invalidate even without an event")
	}
	m := val.(map[string]any)
	runsCfg, ok := m["runs"].(map[string]any)
	if !ok || runsCfg["maxEntries"] != float64(7) {
		t.Errorf("state payload = %#v", m)
	}
}

func TestHotCacheStateAndHealthViews(t *testing.T) {
	dir := t.TempDir()
	state := `{"scheduler":{"line":{"index":3}},"agents":{"qwen":{"failureTimes":[],"disabledTo":null,"deactivated":true}}}`
	mustWrite(t, filepath.Join(dir, "state.json"), state, 0o600)

	c, err := newHotCache(dir)
	if err != nil {
		t.Fatalf("newHotCache: %v", err)
	}
	defer c.Close()

	full, _, err := c.get(CacheState, dir, nil)
	if err != nil {
		t.Fatalf("get state: %v", err)
	}
	sched := full.(map[string]any)["scheduler"].(map[string]any)["line"].(map[string]any)
	if sched["index"] != float64(3) {
		t.Errorf("scheduler payload = %#v", sched)
	}

	health, _, err := c.get(CacheHealth, dir, nil)
	if err != nil {
		t.Fatalf("get health: %v", err)
	}
	agents := health.(map[string]any)["agents"].(map[string]any)
	qwen := agents["qwen"].(map[string]any)
	if qwen["deactivated"] != true {
		t.Errorf("health view = %#v", health)
	}
	if _, leaked := agents["scheduler"]; leaked {
		t.Errorf("health view must expose agents only: %#v", agents)
	}
}

func TestHotCacheHealthWithoutStateFile(t *testing.T) {
	dir := t.TempDir()
	c, err := newHotCache(dir)
	if err != nil {
		t.Fatalf("newHotCache: %v", err)
	}
	defer c.Close()

	val, _, err := c.get(CacheHealth, dir, nil)
	if err != nil {
		t.Fatalf("missing state.json must read as empty health: %v", err)
	}
	agents, ok := val.(map[string]any)["agents"]
	if !ok {
		t.Fatalf("payload = %#v", val)
	}
	if a, ok := agents.(map[string]any); !ok || len(a) != 0 {
		t.Errorf("agents = %#v, want empty map", agents)
	}
}

func TestHotCacheConfigKeepsBytesForClientSideHmac(t *testing.T) {
	dir := t.TempDir()
	t.Setenv("AT_CONFIG_DIR", dir)
	mustWrite(t, filepath.Join(dir, "config.json"), `{"line":["qwen"]}`, 0o600)
	mustWrite(t, filepath.Join(dir, "config.json.hmac"), "deadbeef\n", 0o600)

	c, err := newHotCache(dir)
	if err != nil {
		t.Fatalf("newHotCache: %v", err)
	}
	defer c.Close()

	val, _, err := c.get(CacheConfig, "", nil)
	if err != nil {
		t.Fatalf("get config: %v", err)
	}
	m := val.(map[string]any)
	if m["text"] != `{"line":["qwen"]}` {
		t.Errorf("config text = %#v", m["text"])
	}
	// The daemon must not validate or strip the HMAC — verification stays in
	// src/config.ts so tampering cannot be bypassed through the socket.
	if m["hmac"] != "deadbeef" {
		t.Errorf("config hmac = %#v, want trimmed raw value", m["hmac"])
	}

	mustWrite(t, filepath.Join(dir, "config.json"), `{"line":["kimi"]}`, 0o600)
	waitFor(t, "config invalidation", func() (bool, error) {
		v, _, err := c.get(CacheConfig, "", nil)
		if err != nil {
			return false, err
		}
		return v.(map[string]any)["text"] == `{"line":["kimi"]}`, nil
	})
}

func TestHotCacheConfigMissingFiles(t *testing.T) {
	dir := t.TempDir()
	t.Setenv("AT_CONFIG_DIR", filepath.Join(dir, "nope"))
	c, err := newHotCache(dir)
	if err != nil {
		t.Fatalf("newHotCache: %v", err)
	}
	defer c.Close()

	val, _, err := c.get(CacheConfig, "", nil)
	if err != nil {
		t.Fatalf("missing config must not error: %v", err)
	}
	m := val.(map[string]any)
	if m["text"] != "" || m["hmac"] != "" {
		t.Errorf("payload = %#v, want empty text+hmac", m)
	}
}

func TestHotCacheBinsResolutionHitAndInvalidation(t *testing.T) {
	dir := t.TempDir()
	binA := filepath.Join(dir, "bin-a")
	binB := filepath.Join(dir, "bin-b")
	for _, d := range []string{binA, binB} {
		if err := os.MkdirAll(d, 0o755); err != nil {
			t.Fatalf("mkdir %s: %v", d, err)
		}
	}
	mustWrite(t, filepath.Join(binA, "glm-code"), "#!/bin/sh\n", 0o755)

	params := map[string]any{"candidates": map[string]any{
		"glm-code": []any{filepath.Join(binA, "glm-code")},
		"kimi":     []any{filepath.Join(binA, "kimi"), filepath.Join(binB, "kimi")},
	}}

	c, err := newHotCache(dir)
	if err != nil {
		t.Fatalf("newHotCache: %v", err)
	}
	defer c.Close()

	val, cached, err := c.get(CacheBins, "", params)
	if err != nil {
		t.Fatalf("get bins: %v", err)
	}
	if cached {
		t.Errorf("first bins read must miss")
	}
	m := val.(map[string]any)
	if m["glm-code"] != filepath.Join(binA, "glm-code") {
		t.Errorf("glm-code = %#v", m["glm-code"])
	}
	if m["kimi"] != nil {
		t.Errorf("kimi must resolve to null, got %#v", m["kimi"])
	}
	if _, cached, err = c.get(CacheBins, "", params); err != nil || !cached {
		t.Errorf("second bins read should hit (cached=%v err=%v)", cached, err)
	}

	// A new binary landing in a watched dir must invalidate the answer.
	mustWrite(t, filepath.Join(binB, "kimi"), "#!/bin/sh\n", 0o755)
	waitFor(t, "bins invalidation", func() (bool, error) {
		v, _, err := c.get(CacheBins, "", params)
		if err != nil {
			return false, err
		}
		return v.(map[string]any)["kimi"] == filepath.Join(binB, "kimi"), nil
	})
}

func TestHotCacheBinsUnwatchableDirIsNeverACacheHit(t *testing.T) {
	dir := t.TempDir()
	binA := filepath.Join(dir, "bin")
	if err := os.MkdirAll(binA, 0o755); err != nil {
		t.Fatalf("mkdir: %v", err)
	}
	mustWrite(t, filepath.Join(binA, "qwen"), "#!/bin/sh\n", 0o755)
	// /nonexistent-… cannot be watched, so this name must always be re-resolved.
	params := map[string]any{"candidates": map[string]any{
		"qwen": []any{filepath.Join(binA, "qwen"), filepath.Join(dir, "gone", "qwen")},
	}}

	c, err := newHotCache(dir)
	if err != nil {
		t.Fatalf("newHotCache: %v", err)
	}
	defer c.Close()

	for i := 0; i < 2; i++ {
		_, cached, err := c.get(CacheBins, "", params)
		if err != nil {
			t.Fatalf("get bins: %v", err)
		}
		if cached {
			t.Errorf("read %d: unwatchable candidate dir must never serve a hit", i)
		}
	}
}

func TestHotCacheBinsRejectsBadCandidates(t *testing.T) {
	dir := t.TempDir()
	c, err := newHotCache(dir)
	if err != nil {
		t.Fatalf("newHotCache: %v", err)
	}
	defer c.Close()

	if _, _, err := c.get(CacheBins, "", nil); err == nil {
		t.Errorf("missing candidates must error")
	}
	if _, _, err := c.get(CacheBins, "", map[string]any{"candidates": "nope"}); err == nil {
		t.Errorf("non-object candidates must error")
	}
	if _, _, err := c.get(CacheBins, "", map[string]any{"candidates": map[string]any{"a": "not-a-list"}}); err == nil {
		t.Errorf("non-array candidate list must error")
	}
}

func TestHotCacheUnknownKind(t *testing.T) {
	dir := t.TempDir()
	c, err := newHotCache(dir)
	if err != nil {
		t.Fatalf("newHotCache: %v", err)
	}
	defer c.Close()

	if _, _, err := c.get("secrets", dir, nil); err == nil {
		t.Errorf("unknown cache kind must error")
	}
}

func TestDaemonServesCacheCommands(t *testing.T) {
	dir := t.TempDir()
	t.Setenv("AT_STATE_DIR", dir)
	mustWrite(t, filepath.Join(dir, "runs.jsonl"), `{"runId":"r7","agent":"kimi"}`+"\n", 0o600)

	d := &Daemon{
		SockPath: filepath.Join(dir, "atd.sock"),
		PidPath:  filepath.Join(dir, "atd.pid"),
		Version:  "0.1.0",
		IdleMs:   300000,
	}
	if err := d.Start(); err != nil {
		t.Fatalf("start: %v", err)
	}
	defer d.idleExit()

	call := func(req map[string]any) map[string]any {
		t.Helper()
		conn, err := net.Dial("unix", d.SockPath)
		if err != nil {
			t.Fatalf("dial: %v", err)
		}
		defer conn.Close()
		req["version"] = "0.1.0"
		if err := json.NewEncoder(conn).Encode(req); err != nil {
			t.Fatalf("encode: %v", err)
		}
		var resp map[string]any
		if err := json.NewDecoder(conn).Decode(&resp); err != nil {
			t.Fatalf("decode: %v", err)
		}
		return resp
	}

	resp := call(map[string]any{"cmd": CacheRuns})
	if ok, _ := resp["ok"].(bool); !ok {
		t.Fatalf("runs resp = %#v", resp)
	}
	runs, ok := resp["data"].([]any)
	if !ok || len(runs) != 1 {
		t.Fatalf("runs data = %#v", resp["data"])
	}
	if got := runs[0].(map[string]any)["runId"]; got != "r7" {
		t.Errorf("runId = %#v", got)
	}
	if cached, _ := resp["cached"].(bool); cached {
		t.Errorf("first read must report cached=false")
	}
	if resp := call(map[string]any{"cmd": CacheRuns}); resp["cached"] != true {
		t.Errorf("second read must report cached=true: %#v", resp)
	}

	stats := call(map[string]any{"cmd": CacheStatsCmd})
	data, ok := stats["data"].(map[string]any)
	if okv, _ := stats["ok"].(bool); !okv || !ok {
		t.Fatalf("cache-stats resp = %#v", stats)
	}
	if data["hits"] == nil || data["watched"] == nil {
		t.Errorf("cache-stats payload = %#v", data)
	}

	bins := call(map[string]any{"cmd": CacheBins, "candidates": map[string]any{
		"atd": []any{"/definitely/missing/atd"},
	}})
	if okv, _ := bins["ok"].(bool); !okv {
		t.Fatalf("bins resp = %#v", bins)
	}
	if got := bins["data"].(map[string]any)["atd"]; got != nil {
		t.Errorf("missing bin = %#v, want null", got)
	}

	unknown := call(map[string]any{"cmd": "secrets"})
	if okv, _ := unknown["ok"].(bool); okv {
		t.Errorf("unknown cmd must not report ok: %#v", unknown)
	}
}
