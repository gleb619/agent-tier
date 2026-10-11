import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { getAdapter } from "../../src/notify";
import { makeKiroAdapter } from "../../src/notify/adapters/kiro";

const FIXTURES = path.join(__dirname, "fixtures");

function loadFixture(name: string): string[] {
  return readFileSync(path.join(FIXTURES, name), "utf8").split("\n").filter(Boolean);
}

describe("kiro adapter", () => {
  const adapter = makeKiroAdapter();

  it("transformArgs splices engine + stream-json after chat", () => {
    const base = ["chat", "--no-interactive", "--trust-all-tools", "hello"];
    const out = adapter.transformArgs!({ runId: "r1", eventFile: "/tmp/x" }, base);
    expect(out).toEqual([
      "chat",
      "--agent-engine",
      "v2",
      "--output-format",
      "stream-json",
      "--no-interactive",
      "--trust-all-tools",
      "hello",
    ]);
  });

  it("promptSuffix returns discuss instruction", () => {
    const suffix = adapter.promptSuffix?.({ runId: "r1", eventFile: "/tmp/x" }) ?? "";
    expect(suffix).toContain("discuss ask");
    expect(suffix).toContain("discuss note");
  });

  it("runStarted maps to progress with engine", () => {
    const events = adapter.parseLine!(
      JSON.stringify({
        type: "runStarted",
        data: { payloadSchema: "acp", acpProtocolVersion: 1, engine: "v2" },
      }),
    );
    expect(events).toEqual([{ type: "progress", text: "session started (engine=v2)" }]);
  });

  it("sessionUpdate agent_message_chunk maps to message", () => {
    const events = adapter.parseLine!(
      JSON.stringify({
        type: "sessionUpdate",
        data: {
          sessionId: "s1",
          update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "ok" } },
        },
      }),
    );
    expect(events).toEqual([{ type: "message", text: "ok" }]);
  });

  it("sessionUpdate with empty text returns empty array", () => {
    const events = adapter.parseLine!(
      JSON.stringify({
        type: "sessionUpdate",
        data: {
          sessionId: "s1",
          update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "" } },
        },
      }),
    );
    expect(events).toEqual([]);
  });

  it("sessionUpdate non-message updates return empty array", () => {
    const events = adapter.parseLine!(
      JSON.stringify({
        type: "sessionUpdate",
        data: { sessionId: "s1", update: { sessionUpdate: "tool_call" } },
      }),
    );
    expect(events).toEqual([]);
  });

  it("runFinished emits progress plus finalText message", () => {
    const events = adapter.parseLine!(
      JSON.stringify({
        type: "runFinished",
        data: {
          sessionId: "s1",
          status: "success",
          stopReason: "end_turn",
          finalText: "ok",
          finalTextTruncated: false,
        },
      }),
    );
    expect(events).toEqual([
      { type: "progress", text: "session success (end_turn)" },
      { type: "message", text: "ok" },
    ]);
  });

  it("runFinished without finalText only emits progress", () => {
    const events = adapter.parseLine!(
      JSON.stringify({
        type: "runFinished",
        data: { sessionId: "s1", status: "success", stopReason: "end_turn" },
      }),
    );
    expect(events).toEqual([{ type: "progress", text: "session success (end_turn)" }]);
  });

  it("metadata is ignored (returns empty array)", () => {
    const events = adapter.parseLine!(
      JSON.stringify({
        type: "metadata",
        data: { sessionId: "s1", contextUsagePercentage: 1.23 },
      }),
    );
    expect(events).toEqual([]);
  });

  it("runError is ignored (returns empty array)", () => {
    const events = adapter.parseLine!(
      JSON.stringify({
        type: "runError",
        data: { sessionId: null, stage: "engine", message: "boom" },
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

  it("unknown type returns empty array", () => {
    expect(adapter.parseLine!(JSON.stringify({ type: "something_else" }))).toEqual([]);
  });

  it("long message text is truncated", () => {
    const big = "x".repeat(800);
    const events = adapter.parseLine!(
      JSON.stringify({
        type: "sessionUpdate",
        data: {
          sessionId: "s1",
          update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: big } },
        },
      }),
    );
    expect(events[0]?.text?.endsWith("…")).toBe(true);
    expect(events[0]?.text?.length).toBeLessThanOrEqual(501);
  });

  it("fixture file parses and produces expected event types", () => {
    const lines = loadFixture("kiro.jsonl");
    expect(lines.length).toBeGreaterThan(0);
    const eventTypes = new Set<string>();
    for (const line of lines) {
      for (const e of adapter.parseLine!(line)) {
        eventTypes.add(e.type);
      }
    }
    expect(eventTypes.has("progress")).toBe(true);
    expect(eventTypes.has("message")).toBe(true);
  });

  it("getAdapter returns the kiro adapter for kiro agent", () => {
    const a = getAdapter("kiro");
    expect(a.name).toBe("kiro");
    expect(typeof a.transformArgs).toBe("function");
  });
});
