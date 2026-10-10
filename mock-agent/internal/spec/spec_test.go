package spec

import "testing"

func TestParse_OK(t *testing.T) {
	s, err := Parse([]byte(`{"version":1,"name":"d","steps":[{"kind":"lorem","paragraphs":2}]}`))
	if err != nil {
		t.Fatal(err)
	}
	if s.Name != "d" || len(s.Steps) != 1 || s.Steps[0].Kind != "lorem" {
		t.Fatalf("unexpected: %+v", s)
	}
}

func TestParse_BadJSON(t *testing.T) {
	_, err := Parse([]byte("not json"))
	if err == nil {
		t.Fatal("expected error")
	}
}

func TestParse_VersionMismatch(t *testing.T) {
	_, err := Parse([]byte(`{"version":99}`))
	if err == nil {
		t.Fatal("expected error for version mismatch")
	}
}
