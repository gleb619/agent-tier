package main

import (
	"flag"
	"fmt"
	"os"
	"os/signal"
	"syscall"
	"time"

	"web-server/internal/daemon"
)

func main() {
	idleMs := flag.Int64("idle-ms", 300000, "idle timeout before exit (ms)")
	version := flag.String("version", "0.1.0", "daemon version")
	flag.Parse()

	d := &daemon.Daemon{
		Version: *version,
		IdleMs:  *idleMs,
	}
	if err := d.Start(); err != nil {
		fmt.Fprintf(os.Stderr, "atd start error: %v\n", err)
		os.Exit(1)
	}
	fmt.Println("atd started (pid", os.Getpid(), ") sock", d.SockPath, "idle", d.IdleMs, "ms")

	sig := make(chan os.Signal, 1)
	signal.Notify(sig, syscall.SIGINT, syscall.SIGTERM)
	select {
	case s := <-sig:
		fmt.Println("atd shutting down (signal:", s, ")")
	case <-time.After(time.Duration(*idleMs) * time.Millisecond):
		fmt.Println("atd shutting down (idle timeout)")
	}
}
