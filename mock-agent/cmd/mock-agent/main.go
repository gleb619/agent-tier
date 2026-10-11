// Command mock-agent is the dry-run / test agent for `at`. Without
// any normka trigger it echoes the prompt and exits (legacy behaviour);
// otherwise it parses + executes the JSON spec.
package main

import (
	"fmt"
	"io"
	"os"
	"strings"

	"mock-agent/internal/executor"
	"mock-agent/internal/trigger"
)

func main() {
	// Scan argv manually: flag.Parse stops at the first non-flag arg, so a
	// "--normka" appended AFTER the prompt (how the at CLI forwards it) would
	// never register. The flag is accepted in any position.
	normka := false
	rest := make([]string, 0, len(os.Args)-1)
	for _, arg := range os.Args[1:] {
		if arg == "--normka" {
			normka = true
			continue
		}
		rest = append(rest, arg)
	}

	prompt := strings.Join(rest, " ")
	if stdin, _ := io.ReadAll(os.Stdin); len(stdin) > 0 {
		prompt = strings.TrimSpace(prompt + "\n" + string(stdin))
	}

	cliMarker := ""
	if normka {
		cliMarker = "--normka"
	}

	ok, body := trigger.Detect(cliMarker, prompt)
	if !ok {
		fmt.Printf("[mock] received prompt: %s\n", prompt)
		fmt.Fprintf(os.Stderr, "[mock] working directory: %s\n", mustGetwd())
		fmt.Fprintln(os.Stderr, "[mock] done")
		os.Exit(0)
	}
	if err := executor.Dispatch([]byte(body), os.Stdout, os.Stderr); err != nil {
		fmt.Fprintln(os.Stderr, "[normka] error:", err)
		os.Exit(3)
	}
}

func mustGetwd() string {
	wd, err := os.Getwd()
	if err != nil {
		return "."
	}
	return wd
}
