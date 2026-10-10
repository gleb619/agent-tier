// Package trigger detects normka-mode activation in a prompt and
// returns the leftover JSON spec text (or "" if not activated).
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
//  2. Prompt first non-blank line equals "#NORMKA" (case-insensitive).
//  3. Prompt contains a ```json fenced block with a "// normka:on" line.
func Detect(cliFlagMarker, prompt string) (bool, string) {
	if strings.Contains(cliFlagMarker, "--normka") {
		return true, prompt
	}
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
		break
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
