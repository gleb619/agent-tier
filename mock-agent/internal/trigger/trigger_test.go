package trigger

import "testing"

func TestDetect_NoTrigger(t *testing.T) {
	ok, body := Detect("--no-normka-flag-not-present", "hello world")
	if ok {
		t.Fatalf("expected legacy, got ok=true body=%q", body)
	}
	if body != "" {
		t.Fatalf("expected empty body in legacy path, got %q", body)
	}
}

func TestDetect_CLIFlag(t *testing.T) {
	ok, body := Detect("--normka", `{"version":1,"steps":[]}`)
	if !ok || body == "" {
		t.Fatalf("expected activated; ok=%v body=%q", ok, body)
	}
}

func TestDetect_HashDirective(t *testing.T) {
	prompt := "#NORMKA\n\n{\"version\":1,\"steps\":[]}\n"
	ok, body := Detect("", prompt)
	if !ok {
		t.Fatal("expected activated by #NORMKA")
	}
	if body != "{\"version\":1,\"steps\":[]}" {
		t.Fatalf("body=%q", body)
	}
}

func TestDetect_FencedJSON(t *testing.T) {
	prompt := "```json\n// normka:on\n{\"version\":1,\"steps\":[]}\n```\n"
	ok, _ := Detect("", prompt)
	if !ok {
		t.Fatal("expected activated by fenced block")
	}
}

func TestDetect_CLIFlagWithHashDirective(t *testing.T) {
	// The at CLI appends "--normka" after the prompt; the flag form must still
	// extract the spec from a "#NORMKA"-style prompt instead of JSON-parsing
	// the whole prompt.
	prompt := "#NORMKA\n{\"version\":1,\"steps\":[]}"
	ok, body := Detect("--normka", prompt)
	if !ok {
		t.Fatal("expected activated by CLI flag")
	}
	if body != "{\"version\":1,\"steps\":[]}" {
		t.Fatalf("body=%q", body)
	}
}

func TestDetect_HashDirectiveNotFirstLine(t *testing.T) {
	// Consistent with the at CLI's multiline #NORMKA detection: the directive
	// may appear after leading text (e.g. a prepended global prompt).
	prompt := "some preamble\n\n#NORMKA\n{\"version\":1,\"steps\":[]}"
	ok, body := Detect("", prompt)
	if !ok {
		t.Fatal("expected activated by #NORMKA after preamble")
	}
	if body != "{\"version\":1,\"steps\":[]}" {
		t.Fatalf("body=%q", body)
	}
}
