// Package proxy is the thin Go backend for `at web`: every API request is
// translated to an `at bridge <resource> <verb> [id]` call (see
// docs/bridge.md) whose stdout envelope we unwrap and forward as JSON or
// SSE. The http/static layer is borrowed from internal/static.
//
// Bridge envelope (1 line, compact JSON, terminated by \n):
//
//	{"ok":true,"data":<payload>}
//	{"error":{"code":"<MACHINE_CODE>","message":"..."}}
//
// Machine codes: USAGE, UNKNOWN_RESOURCE, UNKNOWN_VERB, BAD_JSON, INTERNAL,
// NOT_FOUND, INVALID, CONFLICT. Exit codes: 0 ok, 2 usage, 3 application.
package proxy

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os/exec"
	"strings"
	"time"
)

// BridgeTimeout caps any single bridge call. Long-running ops belong to the
// runner, not the proxy.
const BridgeTimeout = 30 * time.Second

// envelope mirrors the CLI's stdout contract (docs/bridge.md §Envelopes).
type envelope struct {
	OK    bool            `json:"ok"`
	Data  json.RawMessage `json:"data,omitempty"`
	Error *bridgeError    `json:"error,omitempty"`
}

type bridgeError struct {
	Code    string `json:"code"`
	Message string `json:"message"`
}

// Result is the unwrapped outcome of one `at bridge` invocation. Exactly one
// of Data / Err is populated on a successful exec parse.
type Result struct {
	Data    json.RawMessage
	Code    string // machine code on error
	Message string // human message on error
	Err     error  // exec, timeout, parse failure
}

// Call runs `at bridge <res> <verb>` writing `params` as a JSON object on
// stdin. `idPositional` is merged into params as `id` when non-empty (matches
// the CLI's [id] positional convention documented in bridge.md).
func Call(ctx context.Context, atBin, res, verb, idPositional string, params map[string]any) Result {
	if idPositional != "" {
		if params == nil {
			params = map[string]any{}
		}
		// Caller-set `id` wins so explicit stdin params always beat the positional.
		if _, has := params["id"]; !has {
			params["id"] = idPositional
		}
	}
	body, err := json.Marshal(params)
	if err != nil {
		return Result{Err: fmt.Errorf("marshal bridge params: %w", err)}
	}
	cctx, cancel := context.WithTimeout(ctx, BridgeTimeout)
	defer cancel()
	cmd := exec.CommandContext(cctx, atBin, "bridge", res, verb)
	cmd.Stdin = bytes.NewReader(body)
	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr
	runErr := cmd.Run()
	raw := bytes.TrimSpace(stdout.Bytes())
	if len(raw) == 0 {
		switch {
		case cctx.Err() != nil:
			return Result{Err: fmt.Errorf("bridge %s %s timed out: %w", res, verb, cctx.Err())}
		case runErr != nil:
			return Result{Err: fmt.Errorf("bridge %s %s exec failed: %w (stderr: %s)", res, verb, runErr, strings.TrimSpace(stderr.String()))}
		default:
			return Result{Err: fmt.Errorf("bridge %s %s returned empty stdout", res, verb)}
		}
	}
	// Stdout is a single JSON line; take the first one when extra bytes
	// leaked through (defensive against future CLI changes).
	if idx := bytes.IndexByte(raw, '\n'); idx >= 0 {
		raw = raw[:idx]
	}
	var env envelope
	if jerr := json.Unmarshal(raw, &env); jerr != nil {
		return Result{Err: fmt.Errorf("bridge %s %s: parse envelope: %w (raw: %s)", res, verb, jerr, raw)}
	}
	if env.OK {
		return Result{Data: env.Data}
	}
	if env.Error != nil {
		return Result{Code: env.Error.Code, Message: env.Error.Message, Err: fmt.Errorf("%s: %s", env.Error.Code, env.Error.Message)}
	}
	return Result{Err: fmt.Errorf("bridge %s %s: envelope missing data and error", res, verb)}
}

// HTTPStatus maps a bridge machine code to the closest HTTP status code.
func HTTPStatus(code string) int {
	switch code {
	case "", "OK":
		return 200
	case "USAGE", "UNKNOWN_RESOURCE", "UNKNOWN_VERB", "BAD_JSON", "INVALID":
		return 400
	case "NOT_FOUND":
		return 404
	case "CONFLICT":
		return 409
	case "INTERNAL":
		return 500
	default:
		return 500
	}
}

// IsExitError reports whether err looks like an *exec.ExitError (the bridge
// CLI exited non-zero). Kept for callers that want exit-code specific
// behaviour beyond Code/Message.
func IsExitError(err error) bool {
	var ee *exec.ExitError
	return errors.As(err, &ee)
}

// drain reads r into a buffer; helper for tests that need the raw envelope.
func drain(r io.Reader) []byte {
	var buf bytes.Buffer
	_, _ = io.Copy(&buf, r)
	return buf.Bytes()
}

// ensure json is referenced even when fmt is the dominant formatter above
// (keeps linters happy without dragging in the encoding/json alias alone).
var _ = json.Marshal
