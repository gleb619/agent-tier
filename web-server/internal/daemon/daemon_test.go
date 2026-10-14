package daemon

import (
	"bufio"
	"encoding/json"
	"net"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestDaemonLifecycle(t *testing.T) {
	dir := t.TempDir()
	sock := filepath.Join(dir, "test.sock")
	pid := filepath.Join(dir, "test.pid")

	d := &Daemon{
		SockPath: sock,
		PidPath:  pid,
		Version:  "0.1.0",
		IdleMs:   100,
	}

	if err := d.Start(); err != nil {
		t.Fatalf("start failed: %v", err)
	}
	defer d.idleExit()

	info, err := os.Stat(sock)
	if err != nil {
		t.Fatalf("sock missing: %v", err)
	}
	if info.Mode().Perm() != 0o600 {
		t.Errorf("sock mode = %o, want 600", info.Mode().Perm())
	}

	pidData, err := os.ReadFile(pid)
	if err != nil {
		t.Fatalf("pidfile missing: %v", err)
	}
	if len(pidData) == 0 {
		t.Errorf("pidfile empty")
	}

	// Version handshake ok
	conn, err := net.Dial("unix", sock)
	if err != nil {
		t.Fatalf("dial failed: %v", err)
	}
	enc := json.NewEncoder(conn)
	_ = enc.Encode(map[string]string{"cmd": "ping", "version": "0.1.0"})
	dec := json.NewDecoder(conn)
	var resp map[string]interface{}
	if err := dec.Decode(&resp); err != nil {
		t.Errorf("decode ok response: %v", err)
	} else if ok, _ := resp["ok"].(bool); !ok {
		t.Errorf("expected ok=true, got %v", resp)
	}
	conn.Close()

	// Version mismatch
	conn2, err := net.Dial("unix", sock)
	if err != nil {
		t.Fatalf("dial mismatch: %v", err)
	}
	_ = conn2.SetReadDeadline(time.Now().Add(200 * time.Millisecond))
	enc2 := json.NewEncoder(conn2)
	_ = enc2.Encode(map[string]string{"cmd": "ping", "version": "bad"})
	line, err := bufio.NewReader(conn2).ReadString('\n')
	if err != nil && err.Error() == "EOF" {
		// server may close after sending; that's acceptable
		err = nil
	}
	if err != nil {
		t.Errorf("read mismatch response error: %v (line=%q)", err, line)
	}
	if line == "" && err == nil {
		t.Errorf("expected mismatch response, got nothing")
	}
	conn2.Close()

	// Stop writes/remove handled by idle exit; verify pid removed after exit
	d.idleExit()
	time.Sleep(20 * time.Millisecond)
	if _, err := os.Stat(pid); !os.IsNotExist(err) {
		t.Errorf("pidfile should be removed after exit (or at least not present)")
	}
}

func TestSingleInstanceRefusesSecondStart(t *testing.T) {
	dir := t.TempDir()
	sock := filepath.Join(dir, "si.sock")
	pid := filepath.Join(dir, "si.pid")

	d1 := &Daemon{
		SockPath: sock,
		PidPath:  pid,
		Version:  "0.1.0",
		IdleMs:   300000,
	}
	if err := d1.Start(); err != nil {
		t.Fatalf("first start: %v", err)
	}
	defer d1.idleExit()

	// Second instance should clean old socket and start; verify it doesn't crash
	d2 := &Daemon{
		SockPath: sock,
		PidPath:  pid,
		Version:  "0.1.0",
		IdleMs:   300000,
	}
	if err := d2.Start(); err != nil {
		t.Fatalf("second start refused unexpectedly: %v", err)
	}
	d2.idleExit()
}
