// Command mock-long-agent simulates a long-running agent. Without a
// normka trigger it streams mock output for MOCK_LONG_DURATION (or
// spec.duration_ms) milliseconds; otherwise it delegates to the
// shared executor and respects spec.duration_ms when present.
package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"os"
	"strings"
	"time"

	"mock-agent/internal/executor"
	"mock-agent/internal/trigger"
)

func main() {
	normka := flag.Bool("normka", false, "activate normka mode")
	flag.Parse()

	prompt := strings.Join(flag.Args(), " ")
	if stdin, _ := io.ReadAll(os.Stdin); len(stdin) > 0 {
		prompt = strings.TrimSpace(prompt + "\n" + string(stdin))
	}
	cliMarker := ""
	if *normka {
		cliMarker = "--normka"
	}
	ok, body := trigger.Detect(cliMarker, prompt)
	if !ok {
		runLegacyStream(prompt)
		return
	}
	if err := runNormka(body); err != nil {
		fmt.Fprintln(os.Stderr, "[normka-long] error:", err)
		os.Exit(3)
	}
}

func runLegacyStream(prompt string) {
	d := envDuration()
	tick := d / 10
	if tick <= 0 {
		tick = time.Second
	}
	deadline := time.Now().Add(d)
	fmt.Fprintf(os.Stderr, "[mock-long] starting for %s\n", d)
	fmt.Fprintf(os.Stderr, "[mock-long] prompt=%q\n", prompt)
	i := 1
	for !time.Now().After(deadline) {
		fmt.Fprintf(os.Stderr, "[mock-long] tick %d\n", i)
		data, _ := json.Marshal(map[string]any{"i": i, "ok": true})
		os.Stdout.Write(data)
		os.Stdout.Write([]byte("\n"))
		i++
		time.Sleep(tick)
	}
	fmt.Fprintln(os.Stderr, "[mock-long] done")
}

func runNormka(body string) error {
	var probe struct {
		DurationMS int `json:"duration_ms"`
	}
	_ = json.Unmarshal([]byte(body), &probe)
	start := time.Now()
	if err := executor.Dispatch([]byte(body), os.Stdout, os.Stderr); err != nil {
		return err
	}
	if probe.DurationMS > 0 {
		elapsed := time.Since(start)
		if remaining := time.Duration(probe.DurationMS)*time.Millisecond - elapsed; remaining > 0 {
			time.Sleep(remaining)
		}
	}
	return nil
}

func envDuration() time.Duration {
	if v := os.Getenv("MOCK_LONG_DURATION"); v != "" {
		if d, err := time.ParseDuration(v + "ms"); err == nil {
			return d
		}
	}
	return 30 * time.Second
}
