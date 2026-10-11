// at-web is the Go replacement for `at web`: read-only WebUI backend serving
// the runs API plus the built SPA. Flags mirror the Node CLI:
//
//	at-web --port 7800 --host 127.0.0.1 --static <dir> --state-dir <dir>
//
// Without --state-dir (or AT_STATE_DIR), state dirs are joined the same way
// as `at status`: project `.at/` (when it holds state) first, then `~/.at/`.
package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"syscall"
	"time"

	"web-server/internal/api"
	"web-server/internal/state"
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
	stateDir := flag.String("state-dir", "", "state dir (collapses the joined project + ~/.at/ default)")
	flag.Parse()

	stateDirs := state.ResolveStatusDirs(*stateDir, resolvedCwd())
	handler := api.New(stateDirs, *staticDir)

	addr := *host + ":" + *port
	server := &http.Server{
		Addr:              addr,
		Handler:           handler,
		ReadHeaderTimeout: 10 * time.Second,
	}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	errCh := make(chan error, 1)
	go func() {
		errCh <- server.ListenAndServe()
	}()

	fmt.Fprintf(os.Stderr, "[at-web] serving on http://%s (state: %v)\n", addr, stateDirs)
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

// resolvedCwd is a tiny helper so the join logic sees a real cwd even when
// PWD is unset.
func resolvedCwd() string {
	if cwd, err := os.Getwd(); err == nil {
		return cwd
	}
	return string(filepath.Separator)
}
