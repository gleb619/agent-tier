package executor

import (
	"bufio"
	"context"
	"io"
	"net/http"
	"strings"
	"time"

	"mock-agent/internal/spec"
)

func init() { Register("sse", sseStep) }

type sseArgs struct {
	URL       string `json:"url"`
	Events    int    `json:"events"`
	TimeoutMS int    `json:"timeout_ms"`
}

func sseStep(step spec.Step, _ io.Writer) error {
	var a sseArgs
	if err := jsonDecode(step.Raw, &a); err != nil {
		return err
	}
	if a.Events <= 0 {
		a.Events = 1
	}
	if a.TimeoutMS <= 0 {
		a.TimeoutMS = 5000
	}
	ctx, cancel := context.WithTimeout(context.Background(), time.Duration(a.TimeoutMS)*time.Millisecond)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, "GET", a.URL, nil)
	if err != nil {
		return err
	}
	req.Header.Set("Accept", "text/event-stream")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	br := bufio.NewReader(resp.Body)
	count := 0
	for {
		line, err := br.ReadString('\n')
		if line != "" && strings.HasPrefix(strings.TrimSpace(line), "data:") {
			count++
			if count >= a.Events {
				return nil
			}
		}
		if err != nil {
			if err == io.EOF {
				return nil
			}
			return err
		}
	}
}
