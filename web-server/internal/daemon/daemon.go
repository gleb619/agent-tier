package daemon

import (
	"bufio"
	"encoding/json"
	"fmt"
	"net"
	"os"
	"path/filepath"
	"sync"
	"syscall"
	"time"
)

const (
	defaultSockName = "atd.sock"
	defaultPidName  = "atd.pid"
	defaultIdleMs   = 300000 // 5 minutes idle before exit
)

type Daemon struct {
	SockPath  string
	PidPath   string
	Version   string
	IdleMs    int64
	listener  net.Listener
	mu        sync.Mutex
	idleTimer *time.Timer
	stopped   bool
}

func (d *Daemon) sockDir() string {
	stateDir := os.Getenv("AT_STATE_DIR")
	if stateDir == "" {
		home, err := os.UserHomeDir()
		if err != nil {
			home = os.TempDir()
		}
		stateDir = filepath.Join(home, ".at")
	}
	return stateDir
}

func (d *Daemon) resolvePaths() {
	dir := d.sockDir()
	os.MkdirAll(dir, 0o700)
	if d.SockPath == "" {
		d.SockPath = filepath.Join(dir, defaultSockName)
	}
	if d.PidPath == "" {
		d.PidPath = filepath.Join(dir, defaultPidName)
	}
}

func (d *Daemon) writePid() error {
	d.resolvePaths()
	return os.WriteFile(d.PidPath, []byte(fmt.Sprintf("%d\n", os.Getpid())), 0o600)
}

func (d *Daemon) readPid() (int, error) {
	b, err := os.ReadFile(d.PidPath)
	if err != nil {
		return 0, err
	}
	var pid int
	_, err = fmt.Sscanf(string(b), "%d", &pid)
	return pid, err
}

func (d *Daemon) isRunning(pid int) bool {
	proc, err := os.FindProcess(pid)
	if err != nil {
		return false
	}
	err = proc.Signal(syscall.Signal(0))
	return err == nil
}

func (d *Daemon) checkSingleInstance() bool {
	d.resolvePaths()
	pid, err := d.readPid()
	if err != nil {
		return true // no pidfile => ok
	}
	if d.isRunning(pid) {
		_ = os.Remove(d.SockPath)
	}
	if _, err := os.Stat(d.SockPath); err == nil {
		os.Remove(d.SockPath)
	}
	return true
}

func (d *Daemon) resetIdle() {
	d.mu.Lock()
	defer d.mu.Unlock()
	if d.idleTimer != nil {
		d.idleTimer.Stop()
	}
	d.idleTimer = time.AfterFunc(time.Duration(d.IdleMs)*time.Millisecond, d.idleExit)
}

func (d *Daemon) idleExit() {
	d.mu.Lock()
	defer d.mu.Unlock()
	d.stopped = true
	if d.listener != nil {
		d.listener.Close()
	}
	_ = os.Remove(d.PidPath)
}

func (d *Daemon) Start() error {
	d.resolvePaths()
	d.checkSingleInstance()
	os.Remove(d.SockPath)
	l, err := net.Listen("unix", d.SockPath)
	if err != nil {
		return fmt.Errorf("listen unix sock: %w", err)
	}
	os.Chmod(d.SockPath, 0o600)
	d.listener = l
	if err := d.writePid(); err != nil {
		return fmt.Errorf("write pidfile: %w", err)
	}
	if d.Version == "" {
		d.Version = "0.1.0"
	}
	if d.IdleMs == 0 {
		d.IdleMs = defaultIdleMs
	}
	d.resetIdle()
	go d.acceptLoop()
	return nil
}

func (d *Daemon) acceptLoop() {
	for {
		conn, err := d.listener.Accept()
		if err != nil {
			if d.stopped {
				return
			}
			continue
		}
		d.resetIdle()
		go d.handleConn(conn)
	}
}

func (d *Daemon) handleConn(conn net.Conn) {
	defer conn.Close()
	scanner := bufio.NewScanner(conn)
	for scanner.Scan() {
		line := scanner.Text()
		var req map[string]string
		if err := json.Unmarshal([]byte(line), &req); err != nil {
			resp := map[string]interface{}{"ok": false, "error": "bad json"}
			_ = json.NewEncoder(conn).Encode(resp)
			continue
		}
		cmd := req["cmd"]
		clientVer := req["version"]
		if d.Version != "" && clientVer != "" && clientVer != d.Version {
			resp := map[string]interface{}{"ok": false, "error": "version mismatch"}
			_ = json.NewEncoder(conn).Encode(resp)
			conn.(*net.UnixConn).CloseWrite()
			return
		}
		switch cmd {
		case "ping", "status":
			_ = json.NewEncoder(conn).Encode(map[string]interface{}{"ok": true, "version": d.Version})
		case "stop":
			_ = json.NewEncoder(conn).Encode(map[string]interface{}{"ok": true})
			d.idleExit()
			return
		default:
			_ = json.NewEncoder(conn).Encode(map[string]interface{}{"ok": false, "error": "unknown cmd"})
		}
	}
}

func (d *Daemon) Stop() error {
	d.resolvePaths()
	if _, err := os.Stat(d.SockPath); err != nil {
		return fmt.Errorf("daemon not running: %w", err)
	}
	conn, err := net.Dial("unix", d.SockPath)
	if err != nil {
		return fmt.Errorf("dial daemon: %w", err)
	}
	defer conn.Close()
	_ = json.NewEncoder(conn).Encode(map[string]string{"cmd": "stop", "version": d.Version})
	buf := make([]byte, 1024)
	_, _ = conn.Read(buf)
	_ = os.Remove(d.PidPath)
	return nil
}

func (d *Daemon) Status() (string, error) {
	d.resolvePaths()
	if _, err := os.Stat(d.SockPath); err != nil {
		return "", fmt.Errorf("daemon not running")
	}
	conn, err := net.Dial("unix", d.SockPath)
	if err != nil {
		return "", fmt.Errorf("dial daemon: %w", err)
	}
	defer conn.Close()
	_ = json.NewEncoder(conn).Encode(map[string]string{"cmd": "ping", "version": d.Version})
	var resp map[string]interface{}
	dec := json.NewDecoder(conn)
	if err := dec.Decode(&resp); err != nil {
		return "", err
	}
	if ok, _ := resp["ok"].(bool); ok {
		if v, ok := resp["version"].(string); ok {
			return v, nil
		}
	}
	return "", fmt.Errorf("unexpected response: %v", resp)
}
