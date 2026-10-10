package executor

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net"
	"net/http"
	"os"
	"time"

	"mock-agent/internal/spec"
)

func init() { Register("discuss", discussStep) }

type discussArgs struct {
	Ask           string `json:"ask"`
	Question      string `json:"question"`
	AnswerAfterMS int    `json:"answer_after_ms"`
}

func discussStep(step spec.Step, _ io.Writer) error {
	var a discussArgs
	if err := jsonDecode(step.Raw, &a); err != nil {
		return err
	}
	url := os.Getenv("AT_DISCUSS_URL")
	if url == "" {
		url = "http://127.0.0.1:8787/ask"
	}
	body, _ := json.Marshal(map[string]string{"ask": a.Ask, "question": a.Question})
	timeout := time.Duration(a.AnswerAfterMS) * time.Millisecond
	if timeout <= 0 {
		timeout = 5 * time.Second
	}
	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, "POST", url, bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		if isTimeoutErr(err) {
			return errors.New("discuss timeout: " + err.Error())
		}
		return err
	}
	defer resp.Body.Close()
	io.Copy(io.Discard, resp.Body)
	return nil
}

func isTimeoutErr(err error) bool {
	if err == nil {
		return false
	}
	var ne net.Error
	if errors.As(err, &ne) && ne.Timeout() {
		return true
	}
	return errors.Is(err, context.DeadlineExceeded)
}
