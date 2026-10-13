package events

// EventType mirrors src/notify/types.ts NotifyEventType.
type EventType string

const (
	TypeStart    EventType = "start"
	TypeMessage  EventType = "message"
	TypeTool     EventType = "tool"
	TypeProgress EventType = "progress"
	TypeError    EventType = "error"
	TypeDone     EventType = "done"
	TypeQuestion EventType = "question"
	TypeAnswer   EventType = "answer"
	TypeRename   EventType = "rename"
)

// Event mirrors the wire shape of src/notify/types.ts NotifyEvent.
type Event struct {
	RunID string         `json:"runId"`
	Agent string         `json:"agent"`
	TS    string         `json:"ts"`
	Seq   int            `json:"seq"`
	Type  EventType      `json:"type"`
	Text  string         `json:"text,omitempty"`
	Data  map[string]any `json:"data,omitempty"`
}

// DiscussFrom mirrors src/notify/types.ts DiscussFrom.
type DiscussFrom string

const (
	FromAgent DiscussFrom = "agent"
	FromHost  DiscussFrom = "host"
)

// DiscussKind mirrors src/notify/types.ts DiscussKind.
type DiscussKind string

const (
	KindQuestion DiscussKind = "question"
	KindAnswer   DiscussKind = "answer"
	KindSay      DiscussKind = "say"
	KindNote     DiscussKind = "note"
)

// DiscussEntry mirrors src/notify/types.ts DiscussEntry.
type DiscussEntry struct {
	ID      string      `json:"id"`
	From    DiscussFrom `json:"from"`
	Kind    DiscussKind `json:"kind"`
	Text    string      `json:"text"`
	Options []string    `json:"options,omitempty"`
	ReplyTo string      `json:"replyTo,omitempty"`
	TS      string      `json:"ts"`
}
