// Package trigger detects normka-mode activation in a prompt
// and returns the leftover JSON spec text (or "" if not activated).
package trigger

import (
	"regexp"
	"strings"
)

// Version is the package version string used in step output.
const Version = "0.1.0"

var fenceRe = regexp.MustCompile("(?s)```json\\s*\\n(// normka:on.*?)\\n```")

// Detect decides whether normka mode is active for the given prompt.
// cliFlagMarker is non-empty when the caller passes --normka; the
// concrete marker substring "--normka" enables the CLI-flag form.
// prompt is the user's message (with prompts joined). Returns
// (activated, leftoverJSON).
//
// Forms:
//  1. CLI flag "--normka" present in cliFlagMarker.
//  2. Prompt contains a line equal to "#NORMKA" (case-insensitive).
//  3. Prompt contains a ```json fenced block with a "// normka:on" line.
//
// Form 1 uses the same extraction as forms 2/3 when the prompt carries a
// directive, so callers may pass "--normka" alongside (before OR after)
// a "#NORMKA"-style prompt and still get a clean JSON body.
func Detect(cliFlagMarker, prompt string) (bool, string) {
	if strings.Contains(cliFlagMarker, "--normka") {
		if ok, body := detectBody(prompt); ok {
			return true, body
		}
		return true, prompt
	}
	return detectBody(prompt)
}

// detectBody locates a normka JSON spec inside a prompt: the hash directive
// form (a line equal to "#NORMKA"; everything after that line is the spec)
// or the ```json fenced-block form.
func detectBody(prompt string) (bool, string) {
	lines := strings.Split(prompt, "\n")
	for _, line := range lines {
		trim := strings.TrimSpace(line)
		if trim == "" {
			continue
		}
		if strings.EqualFold(trim, "#NORMKA") {
			idx := strings.Index(prompt, line)
			if idx < 0 {
				return true, ""
			}
			rest := prompt[idx+len(line):]
			return true, strings.TrimSpace(rest)
		}
	}
	if m := fenceRe.FindStringSubmatch(prompt); len(m) >= 2 {
		body := m[1]
		parts := strings.SplitN(body, "\n", 2)
		if len(parts) > 0 && strings.Contains(parts[0], "normka:on") {
			body = strings.TrimSpace(parts[1])
		}
		return true, strings.TrimSpace(body)
	}
	return false, ""
}
