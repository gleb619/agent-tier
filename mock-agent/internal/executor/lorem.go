package executor

import (
	"fmt"
	"io"
	"strings"

	"mock-agent/internal/spec"
)

const lipsum = "Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua."

func init() { Register("lorem", lorem) }

type loremArgs struct {
	Paragraphs int `json:"paragraphs"`
}

func lorem(step spec.Step, w io.Writer) error {
	var a loremArgs
	if err := jsonDecode(step.Raw, &a); err != nil {
		return err
	}
	if a.Paragraphs <= 0 {
		a.Paragraphs = 1
	}
	for i := 0; i < a.Paragraphs; i++ {
		fmt.Fprintln(w, strings.Repeat(lipsum+" ", 3))
	}
	return nil
}
