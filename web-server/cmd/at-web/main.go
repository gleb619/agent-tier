// at-web is the thin Go proxy for `at web`: a HTTP+static+SSE backend that
// translates every request into an `at bridge <resource> <verb> [id]` call
// (see docs/bridge.md) and serves the built SPA. Mutations that don't have a
// bridge verb yet (POST /api/runs, /api/runs/:id/retry, PUT agents,
// /api/settings, /api/runs/:id/log) exec `at` directly — see internal/proxy.
//
// Flags mirror the Node CLI:
//
//	at-web --port 7800 --host 127.0.0.1 --static <dir> --state-dir <dir>
//
// --state-dir is accepted for parity with prior releases; the proxy no
// longer needs it (the bridge does its own state-dir resolution via
// AT_STATE_DIR).
package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"log"
	"net"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"syscall"
	"time"

	"web-server/internal/proxy"
)

const (
	defaultPort = "7800"
	defaultHost = "127.0.0.1"
	shutdownTTL = 5 * time.Second
)

func main() {
	if err := run(); err != nil {
		log.Fatal(err)
	}
}

func run() error {
	port := flag.String("port", defaultPort, "listen port")
	host := flag.String("host", defaultHost, "bind address (127.0.0.1 default; 0.0.0.0 for containers)")
	staticDir := flag.String("static", "", "webui build dir (empty = API-only)")
	// Accepted for parity with prior releases; unused — the proxy currently
	// trusts the at bridge to resolve state dirs the way `at status` does.
	_ = flag.String("state-dir", "", "state dir (unused; bridge resolves via AT_STATE_DIR)")
	flag.Parse()

	srv := proxy.New(*staticDir)
	srv.SetBaseURL("")

	addr := *host + ":" + *port
	server := &http.Server{
		Handler:           srv.Handler(),
		ReadHeaderTimeout: 10 * time.Second,
	}

	listener, err := net.Listen("tcp", addr)
	if err != nil {
		return fmt.Errorf("failed to listen on %s: %w", addr, err)
	}
	defer listener.Close()

	actualAddr := listener.Addr().String()
	fmt.Fprintf(os.Stderr, "[at-web] serving on http://%s (bridge via: %s)\n", actualAddr, srv.AtBin)

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	errCh := make(chan error, 1)
	go func() {
		errCh <- server.Serve(listener)
	}()

	select {
	case err := <-errCh:
		if !errors.Is(err, http.ErrServerClosed) {
			return err
		}
	case <-ctx.Done():
		log.Printf("[at-web] shutting down")
		shutdownCtx, cancel := context.WithTimeout(context.Background(), shutdownTTL)
		defer cancel()
		return server.Shutdown(shutdownCtx)
	}
	return nil
}

// resolvedCwd unused after the proxy refactor; kept as the package root
// symbol so future shells (e.g. daemon command) can call it without
// re-importing `path/filepath`.
func resolvedCwd() string {
	if cwd, err := os.Getwd(); err == nil {
		return cwd
	}
	return string(filepath.Separator)
}
