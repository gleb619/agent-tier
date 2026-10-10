package trigger

import "testing"

func TestVersionString(t *testing.T) {
	if Version == "" {
		t.Fatal("Version must be set")
	}
}
