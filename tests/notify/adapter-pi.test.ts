import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { renderStreamJsonLine } from "../../src/chop";
import { getAdapter } from "../../src/notify";
import { makePiAdapter } from "../../src/notify/adapters/pi";

const FIXTURES = path.join(__dirname, "fixtures");

function loadFixture(name: string): string[] {
  return readFileSync(path.join(FIXTURES, name), "utf8").split("\n").filter(Boolean);
}

describe("pi adapter", () => {
  const adapter = makePiAdapter();

  it("transformArgs inserts --mode json before the prompt", () => {
    const base = ["-p", "--provider", "ollama", "--model", "qwen2.5:7b", "--no-session", "hello"];
    const out = adapter.transformArgs!({ runId: "r1", eventFile: "/tmp/x" }, base);
    expect(out).toEqual([
      "-p",
      "--provider",
      "ollama",
      "--model",
      "qwen2.5:7b",
      "--no-session",
      "--mode",
      "json",
      "hello",
    ]);
  });

  it("promptSuffix returns discuss instruction", () => {
    const suffix = adapter.promptSuffix?.({ runId: "r1", eventFile: "/tmp/x" }) ?? "";
    expect(suffix).toContain("discuss ask");
    expect(suffix).toContain("discuss note");
  });

  it("session maps to progress with session_id", () => {
    const events = adapter.parseLine!(
      JSON.stringify({
        type: "session",
        version: 3,
        id: "01a11ef0-fcd5-77e5-8dcb-71fa3a4d8c50",
      }),
    );
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: "progress",
      text: "session started",
      data: { session_id: "01a11ef0-fcd5-77e5-8dcb-71fa3a4d8c50" },
    });
  });

  it("agent_start maps to progress", () => {
    expect(adapter.parseLine!(JSON.stringify({ type: "agent_start" }))).toEqual([
      { type: "progress", text: "agent started" },
    ]);
  });

  it("turn_start maps to progress", () => {
    expect(adapter.parseLine!(JSON.stringify({ type: "turn_start" }))).toEqual([
      { type: "progress", text: "turn started" },
    ]);
  });

  it("message_end with assistant text maps to message", () => {
    const events = adapter.parseLine!(
      JSON.stringify({
        type: "message_end",
        message: { role: "assistant", content: [{ type: "text", text: "ok" }] },
      }),
    );
    expect(events).toEqual([{ type: "message", text: "ok" }]);
  });

  it("message_end with assistant text and tool_use maps to message+tool", () => {
    const events = adapter.parseLine!(
      JSON.stringify({
        type: "message_end",
        message: {
          role: "assistant",
          content: [
            { type: "text", text: "hi" },
            { type: "tool_use", name: "Bash", input: { command: "ls" } },
          ],
        },
      }),
    );
    expect(events).toHaveLength(2);
    expect(events[0]).toEqual({ type: "message", text: "hi" });
    expect(events[1]).toMatchObject({ type: "tool", text: "Bash ls" });
  });

  it("message_start with errorMessage maps to error", () => {
    const events = adapter.parseLine!(
      JSON.stringify({
        type: "message_start",
        message: { role: "assistant", content: [], errorMessage: "404 not found" },
      }),
    );
    expect(events).toEqual([{ type: "error", text: "404 not found" }]);
  });

  it("non-assistant message returns empty array", () => {
    const events = adapter.parseLine!(
      JSON.stringify({
        type: "message_end",
        message: { role: "user", content: [{ type: "text", text: "hi" }] },
      }),
    );
    expect(events).toEqual([]);
  });

  it("turn_end with errorMessage renders FAILED", () => {
    const events = adapter.parseLine!(
      JSON.stringify({
        type: "turn_end",
        errorMessage: "404 model not found",
        stopReason: "error",
      }),
    );
    expect(events[0].text).toContain("FAILED");
    expect(events[0].data).toMatchObject({ stopReason: "error" });
  });

  it("turn_end without errorMessage renders done", () => {
    expect(adapter.parseLine!(JSON.stringify({ type: "turn_end" }))).toEqual([
      expect.objectContaining({ type: "progress", text: expect.stringContaining("done") }),
    ]);
  });

  it("agent_end and agent_settled map to progress", () => {
    expect(adapter.parseLine!(JSON.stringify({ type: "agent_end" }))).toEqual([
      { type: "progress", text: "agent ended" },
    ]);
    expect(adapter.parseLine!(JSON.stringify({ type: "agent_settled" }))).toEqual([
      { type: "progress", text: "session settled" },
    ]);
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

  it("unknown type returns empty array", () => {
    expect(adapter.parseLine!(JSON.stringify({ type: "mystery" }))).toEqual([]);
  });

  it("synthetic fixture parses and produces expected event types", () => {
    const lines = loadFixture("pi.synthetic.jsonl");
    expect(lines.length).toBeGreaterThan(5);
    const eventTypes = new Set<string>();
    let sawError = false;
    for (const line of lines) {
      for (const e of adapter.parseLine!(line)) {
        eventTypes.add(e.type);
        if (e.type === "error") sawError = true;
      }
    }
    expect(eventTypes.has("progress")).toBe(true);
    expect(sawError).toBe(true);
  });

  it("renderStreamJsonLine renders pi session", () => {
    expect(renderStreamJsonLine(JSON.stringify({ type: "session", id: "x" }))).toContain("session started");
  });

  it("renderStreamJsonLine renders pi error", () => {
    const out = renderStreamJsonLine(
      JSON.stringify({
        type: "message_start",
        message: { role: "assistant", content: [], errorMessage: "404 not found" },
      }),
    );
    expect(out).toContain("404 not found");
  });

  it("getAdapter returns the pi adapter for pi agent", () => {
    const a = getAdapter("pi");
    expect(a.name).toBe("pi");
    expect(typeof a.transformArgs).toBe("function");
  });
});
