import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { getAdapter } from "../../src/notify";
import { makeCodexAdapter } from "../../src/notify/adapters/codex";

const FIXTURES = path.join(__dirname, "fixtures");

function loadFixture(name: string): string[] {
  return readFileSync(path.join(FIXTURES, name), "utf8").split("\n").filter(Boolean);
}

describe("codex adapter", () => {
  const adapter = makeCodexAdapter();

  it("transformArgs inserts --json before the prompt", () => {
    const base = ["exec", "--yolo", "--skip-git-repo-check", "hello"];
    const out = adapter.transformArgs!({ runId: "r1", eventFile: "/tmp/x" }, base);
    expect(out).toEqual(["exec", "--yolo", "--skip-git-repo-check", "--json", "hello"]);
  });

  it("promptSuffix returns discuss instruction", () => {
    const suffix = adapter.promptSuffix?.({ runId: "r1", eventFile: "/tmp/x" }) ?? "";
    expect(suffix).toContain("discuss ask");
    expect(suffix).toContain("discuss note");
  });

  it("thread.started maps to progress with thread_id", () => {
    const line = JSON.stringify({ type: "thread.started", thread_id: "abc-123" });
    const events = adapter.parseLine!(line);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: "progress", text: "session started", data: { thread_id: "abc-123" } });
  });

  it("turn.started maps to progress", () => {
    const events = adapter.parseLine!(JSON.stringify({ type: "turn.started" }));
    expect(events[0]).toMatchObject({ type: "progress", text: "turn started" });
  });

  it("turn.completed maps to progress with usage", () => {
    const events = adapter.parseLine!(
      JSON.stringify({
        type: "turn.completed",
        usage: { input_tokens: 10, output_tokens: 5 },
      }),
    );
    expect(events[0]).toMatchObject({ type: "progress", text: "turn finished" });
    expect(events[0].data).toEqual({ usage: { input_tokens: 10, output_tokens: 5 } });
  });

  it("item.completed agent_message maps to message", () => {
    const events = adapter.parseLine!(
      JSON.stringify({
        type: "item.completed",
        item: { type: "agent_message", text: "ok" },
      }),
    );
    expect(events).toEqual([{ type: "message", text: "ok" }]);
  });

  it("item.started command_execution maps to tool with trailing ellipsis", () => {
    const events = adapter.parseLine!(
      JSON.stringify({
        type: "item.started",
        item: { type: "command_execution", command: "cat /etc/hostname", status: "in_progress" },
      }),
    );
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("tool");
    expect(events[0].text).toContain("cat /etc/hostname");
    expect(events[0].text).toContain("…");
    expect(events[0].data).toMatchObject({ name: "Bash", status: "in_progress" });
  });

  it("item.completed command_execution maps to tool with exit_code", () => {
    const events = adapter.parseLine!(
      JSON.stringify({
        type: "item.completed",
        item: { type: "command_execution", command: "ls", exit_code: 0, status: "completed" },
      }),
    );
    expect(events[0]).toMatchObject({
      type: "tool",
      text: "Bash ls",
      data: { name: "Bash", exit_code: 0, status: "completed" },
    });
  });

  it("item.completed error maps to error event", () => {
    const events = adapter.parseLine!(
      JSON.stringify({
        type: "item.completed",
        item: { type: "error", message: "rate limit hit" },
      }),
    );
    expect(events).toEqual([{ type: "error", text: "rate limit hit" }]);
  });

  it("item.completed reasoning maps to progress (no text leak)", () => {
    const events = adapter.parseLine!(
      JSON.stringify({
        type: "item.completed",
        item: { type: "reasoning", text: "thinking hard about X" },
      }),
    );
    expect(events).toEqual([{ type: "progress", text: "reasoning" }]);
  });

  it("item.completed file_change maps to tool", () => {
    const events = adapter.parseLine!(
      JSON.stringify({
        type: "item.completed",
        item: { type: "file_change", path: "/tmp/foo.txt", kind: "create" },
      }),
    );
    expect(events[0]).toMatchObject({
      type: "tool",
      text: "File create /tmp/foo.txt",
      data: { name: "FileChange" },
    });
  });

  it("item.completed web_search maps to tool", () => {
    const events = adapter.parseLine!(
      JSON.stringify({
        type: "item.completed",
        item: { type: "web_search", query: "paris" },
      }),
    );
    expect(events[0]).toMatchObject({ type: "tool", text: "WebSearch paris" });
  });

  it("unknown item.type returns empty array", () => {
    const events = adapter.parseLine!(
      JSON.stringify({
        type: "item.completed",
        item: { type: "some_unknown" },
      }),
    );
    expect(events).toEqual([]);
  });

  it("non-JSON line returns empty array", () => {
    expect(adapter.parseLine!("just text")).toEqual([]);
  });

  it("malformed JSON returns empty array (never throws)", () => {
    expect(adapter.parseLine!("{not json")).toEqual([]);
  });

  it("empty line returns empty array", () => {
    expect(adapter.parseLine!("")).toEqual([]);
  });

  it("unknown top-level type returns empty array", () => {
    expect(adapter.parseLine!(JSON.stringify({ type: "something_else" }))).toEqual([]);
  });

  it("fixture file parses with no errors and produces expected event types", () => {
    const lines = loadFixture("codex.jsonl");
    expect(lines.length).toBeGreaterThan(5);
    const eventTypes = new Set<string>();
    for (const line of lines) {
      for (const e of adapter.parseLine!(line)) {
        eventTypes.add(e.type);
      }
    }
    expect(eventTypes.has("progress")).toBe(true);
    expect(eventTypes.has("message")).toBe(true);
    expect(eventTypes.has("tool")).toBe(true);
  });

  it("getAdapter returns the codex adapter for codex agent", () => {
    const a = getAdapter("codex");
    expect(a.name).toBe("codex");
    expect(typeof a.transformArgs).toBe("function");
  });
});
