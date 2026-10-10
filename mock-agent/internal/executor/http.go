package executor

import (
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"mock-agent/internal/spec"
)

func init() { Register("http", httpStep) }

type httpArgs struct {
	Method string `json:"method"`
	URL    string `json:"url"`
	Expect []int  `json:"expect"`
}

func httpStep(step spec.Step, _ io.Writer) error {
	var a httpArgs
	if err := jsonDecode(step.Raw, &a); err != nil {
		return err
	}
	if a.Method == "" {
		a.Method = "GET"
	}
	if a.Expect == nil {
		a.Expect = []int{200, 201, 202, 204}
	}
	client := &http.Client{Timeout: 10 * time.Second}
	req, err := http.NewRequest(a.Method, a.URL, strings.NewReader(""))
	if err != nil {
		return err
	}
	resp, err := client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	for _, want := range a.Expect {
		if resp.StatusCode == want {
			return nil
		}
	}
	return fmt.Errorf("status %d not in expect %v", resp.StatusCode, a.Expect)
}
