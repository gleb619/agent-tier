// Mutations: the minimal write path the Go web server needs — marking a run
// failed after a kill. Writes go through the SAME lock protocol as the Node
// CLI (src/lock.ts): a lock file in <dir>/locks/, O_EXCL creation, stale-lock
// steal when the holder pid is dead, 50ms polling, 5s default timeout. The
// runs file itself is rewritten atomically (tmp + rename), like writeJsonl in
// src/run-store.ts.
package runs

import (
	"encoding/json"
	"errors"
	"fmt"
	"math/rand"
	"os"
	"path/filepath"
	"strings"
	"time"
)

const (
	lockPollInterval = 50 * time.Millisecond
	defaultLockTTL   = 5 * time.Second
)

// pathToLockName mirrors pathToLockName in src/lock.ts so Node and Go
// processes contend for the same lock file.
func pathToLockName(filePath string) string {
	normalized := strings.TrimPrefix(filePath, "/")
	return strings.NewReplacer("/", "-", ".", "-").Replace(strings.ToLower(normalized)) + ".lock"
}

type lockInfo struct {
	Pid       int    `json:"pid"`
	Hostname  string `json:"hostname"`
	StartedAt string `json:"startedAt"`
	StateFile string `json:"stateFile"`
}

func lockPathFor(filePath string) string {
	return filepath.Join(filepath.Dir(filePath), "locks", pathToLockName(filePath))
}

func acquireLock(filePath string, timeout time.Duration) (string, error) {
	lockPath := lockPathFor(filePath)
	if err := os.MkdirAll(filepath.Dir(lockPath), 0o755); err != nil {
		return "", err
	}
	hostname, _ := os.Hostname()
	info := lockInfo{
		Pid:       os.Getpid(),
		Hostname:  hostname,
		StartedAt: NowISO(time.Now()),
		StateFile: filePath,
	}
	raw, _ := json.Marshal(info)

	deadline := time.Now().Add(timeout)
	for {
		// O_EXCL create, mirroring writeFileSync({ flag: "wx" }) in src/lock.ts.
		f, err := os.OpenFile(lockPath, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o644)
		if err == nil {
			if _, err := f.Write(raw); err != nil {
				_ = f.Close()
				return "", err
			}
			return lockPath, f.Close()
		}
		if !errors.Is(err, os.ErrExist) {
			return "", err
		}
		stale := true
		if existing, readErr := os.ReadFile(lockPath); readErr == nil {
			var holder lockInfo
			if json.Unmarshal(existing, &holder) == nil && PidAlive(holder.Pid) {
				stale = false
			}
		}
		if stale {
			// Dead or unreadable lock: remove and retry immediately.
			_ = os.Remove(lockPath)
			continue
		}
		if time.Now().Before(deadline) {
			time.Sleep(lockPollInterval)
			continue
		}
		return "", fmt.Errorf("failed to acquire lock for %s after %s", filePath, timeout)
	}
}

// WithLock runs fn while holding the TS-compatible lock for filePath.
func WithLock(filePath string, fn func() error) error {
	return WithLockTimeout(filePath, fn, defaultLockTTL)
}

// WithLockTimeout is WithLock with an explicit timeout.
func WithLockTimeout(filePath string, fn func() error, timeout time.Duration) error {
	lockPath, err := acquireLock(filePath, timeout)
	if err != nil {
		return err
	}
	defer func() { _ = os.Remove(lockPath) }()
	return fn()
}

// writeJsonl mirrors writeJsonl in src/run-store.ts: one JSON object per
// line, trailing newline when non-empty, atomic via tmp + rename.
func writeJsonl(filePath string, list []RunRecord) error {
	if err := os.MkdirAll(filepath.Dir(filePath), 0o755); err != nil {
		return err
	}
	var b strings.Builder
	for _, r := range list {
		raw, err := json.Marshal(r)
		if err != nil {
			return err
		}
		b.Write(raw)
		b.WriteByte('\n')
	}
	tmp := fmt.Sprintf("%s.tmp-%d-%d-%d", filePath, os.Getpid(), time.Now().UnixNano(), rand.Intn(1<<30))
	if err := os.WriteFile(tmp, []byte(b.String()), jsonFileMode); err != nil {
		return err
	}
	if err := os.Rename(tmp, filePath); err != nil {
		_ = os.Remove(tmp)
		return err
	}
	return nil
}

// UpdateRun patches the stored record (exact runId match) and rewrites
// runs.jsonl under the TS lock. Unknown ids leave the file untouched,
// matching updateRun in src/run-store.ts. Only the exact fields present in
// updates are applied; startedAt ordering is preserved.
func UpdateRun(dir, runId string, updates map[string]any) error {
	runsFile := filepath.Join(dir, runsFile)
	return WithLock(runsFile, func() error {
		list := LoadRuns(dir)
		idx := -1
		for i, r := range list {
			if r.RunID == runId {
				idx = i
				break
			}
		}
		if idx < 0 {
			return nil
		}
		patched, err := applyUpdates(list[idx], updates)
		if err != nil {
			return err
		}
		list[idx] = patched
		return writeJsonl(runsFile, list)
	})
}

func applyUpdates(r RunRecord, updates map[string]any) (RunRecord, error) {
	if v, ok := updates["status"]; ok {
		s, ok := v.(string)
		if !ok {
			return r, fmt.Errorf("status must be a string")
		}
		r.Status = s
	}
	if v, ok := updates["finishedAt"]; ok {
		if v == nil {
			r.FinishedAt = nil
		} else {
			s, ok := v.(string)
			if !ok {
				return r, fmt.Errorf("finishedAt must be a string or null")
			}
			r.FinishedAt = &s
		}
	}
	if v, ok := updates["exitCode"]; ok {
		if v == nil {
			r.ExitCode = nil
		} else {
			f, ok := v.(float64)
			if !ok {
				return r, fmt.Errorf("exitCode must be a number or null")
			}
			n := int(f)
			r.ExitCode = &n
		}
	}
	if v, ok := updates["name"]; ok {
		s, ok := v.(string)
		if !ok {
			return r, fmt.Errorf("name must be a string")
		}
		r.Name = s
	}
	return r, nil
}
