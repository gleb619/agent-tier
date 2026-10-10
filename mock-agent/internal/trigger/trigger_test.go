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
