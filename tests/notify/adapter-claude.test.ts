import { describe, expect, it } from "vitest";
import { renderStreamJsonLine } from "../../src/chop";
import { getAdapter, logAdapter, registerAdapter } from "../../src/notify";
import { makeClaudeAdapter } from "../../src/notify/adapters/claude";

describe("claude adapter", () => {
  const adapter = makeClaudeAdapter("mm-code");

  it("args returns stream-json flags", () => {
    expect(adapter.args?.({ runId: "r1", eventFile: "/tmp/x" })).toEqual([
      "--output-format",
      "stream-json",
      "--verbose",
    ]);
  });

  it("promptSuffix returns discuss instruction", () => {
    const suffix = adapter.promptSuffix?.({ runId: "r1", eventFile: "/tmp/x" }) ?? "";
    expect(suffix).toContain("discuss ask");
    expect(suffix).toContain("discuss note");
    expect(suffix).toContain("$AT_BIN");
  });

  it("system init maps to progress with model", () => {
    const line = JSON.stringify({
      type: "system",
      subtype: "init",
      model: "claude-sonnet-4",
      tools: [],
    });
    const events = adapter.parseLine!(line);
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("progress");
    expect(events[0].text).toBe("session started");
    expect(events[0].data).toEqual({ model: "claude-sonnet-4" });
  });

  it("assistant text block maps to message (truncated 500)", () => {
    const long = "x".repeat(800);
    const line = JSON.stringify({
      type: "assistant",
      message: {
        role: "assistant",
        content: [{ type: "text", text: long }],
      },
    });
    const events = adapter.parseLine!(line);
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("message");
    expect((events[0].text ?? "").length).toBe(501); // 500 chars + ellipsis
    expect((events[0].text ?? "").endsWith("…")).toBe(true);
  });

  it("assistant tool_use maps to tool with name and summary", () => {
    const line = JSON.stringify({
      type: "assistant",
      message: {
        role: "assistant",
        content: [
          {
            type: "tool_use",
            id: "t1",
            name: "Read",
            input: { file_path: "/etc/hosts" },
          },
        ],
      },
    });
    const events = adapter.parseLine!(line);
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("tool");
    expect(events[0].text).toBe("Read /etc/hosts");
    expect(events[0].data).toEqual({ name: "Read" });
  });

  it("assistant tool_use Bash uses command field", () => {
    const line = JSON.stringify({
      type: "assistant",
      message: {
        role: "assistant",
        content: [
          {
            type: "tool_use",
            id: "t1",
            name: "Bash",
            input: { command: "ls -la", description: "list files" },
          },
        ],
      },
    });
    const events = adapter.parseLine!(line);
    expect(events[0].text).toBe("Bash ls -la");
  });

  it("assistant with mixed text+tool_use emits both", () => {
    const line = JSON.stringify({
      type: "assistant",
      message: {
        role: "assistant",
        content: [
          { type: "text", text: "thinking..." },
          { type: "tool_use", id: "t1", name: "Grep", input: { pattern: "TODO" } },
        ],
      },
    });
    const events = adapter.parseLine!(line);
    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({ type: "message", text: "thinking..." });
    expect(events[1]).toMatchObject({ type: "tool", text: "Grep TODO", data: { name: "Grep" } });
  });

  it("user tool_result with is_error maps to error", () => {
    const line = JSON.stringify({
      type: "user",
      message: {
        role: "user",
        content: [{ type: "tool_result", tool_use_id: "t1", content: "ENOENT: no such file", is_error: true }],
      },
    });
    const events = adapter.parseLine!(line);
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("error");
    expect(events[0].text).toBe("ENOENT: no such file");
  });

  it("user tool_result without is_error returns empty", () => {
    const line = JSON.stringify({
      type: "user",
      message: {
        role: "user",
        content: [{ type: "tool_result", tool_use_id: "t1", content: "ok" }],
      },
    });
    expect(adapter.parseLine!(line)).toEqual([]);
  });

  it("result maps to progress with cost data", () => {
    const line = JSON.stringify({
      type: "result",
      subtype: "success",
      duration_ms: 1234,
      num_turns: 3,
      total_cost_usd: 0.0042,
      is_error: false,
    });
    const events = adapter.parseLine!(line);
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("progress");
    expect(events[0].data).toEqual({
      duration_ms: 1234,
      num_turns: 3,
      total_cost_usd: 0.0042,
      is_error: false,
    });
  });

  it("non-JSON line returns empty array", () => {
    expect(adapter.parseLine!("just some text")).toEqual([]);
  });

  it("empty line returns empty array", () => {
    expect(adapter.parseLine!("")).toEqual([]);
  });

  it("unknown type returns empty array", () => {
    expect(adapter.parseLine!(JSON.stringify({ type: "something_else" }))).toEqual([]);
  });

  it("malformed JSON returns empty array (never throws)", () => {
    expect(adapter.parseLine!("{not json")).toEqual([]);
  });

  it("getAdapter returns the registered claude adapter, not log adapter", () => {
    const a = getAdapter("mm-code");
    expect(a).not.toBe(logAdapter);
    expect(a.name).toBe("mm-code");
    expect(a.args?.({ runId: "r1", eventFile: "/tmp/x" })).toContain("--output-format");
  });

  it("getAdapter for glm-code returns claude adapter variant", () => {
    const a = getAdapter("glm-code");
    expect(a.name).toBe("glm-code");
    expect(a.args?.({ runId: "r1", eventFile: "/tmp/x" })).toEqual(["--output-format", "stream-json", "--verbose"]);
  });

  it("adapter names are independent (mm-code and glm-code are separate instances)", () => {
    // Names are baked at make time; calling makeClaudeAdapter again produces a
    // new instance — registry stores one entry per name, so the same object
    // should be returned for repeated lookups.
    const a = getAdapter("mm-code");
    const b = getAdapter("mm-code");
    expect(a).toBe(b);
  });

  it("re-registering replaces the adapter", () => {
    const before = getAdapter("mm-code");
    registerAdapter("mm-code", logAdapter);
    const after = getAdapter("mm-code");
    expect(after).toBe(logAdapter);
    // restore for any later tests in the same process
    registerAdapter("mm-code", before);
  });
});

describe("renderStreamJsonLine (chop)", () => {
  it("non-JSON line returns null", () => {
    expect(renderStreamJsonLine("just text")).toBeNull();
  });

  it("system init returns readable line", () => {
    const line = JSON.stringify({ type: "system", model: "claude-x" });
    expect(renderStreamJsonLine(line)).toBe("[system] session started (model=claude-x)");
  });

  it("assistant text returns content", () => {
    const line = JSON.stringify({
      type: "assistant",
      message: { content: [{ type: "text", text: "hello" }] },
    });
    expect(renderStreamJsonLine(line)).toBe("hello");
  });

  it("assistant tool_use returns prefixed line", () => {
    const line = JSON.stringify({
      type: "assistant",
      message: { content: [{ type: "tool_use", name: "Read", input: { file_path: "/a" } }] },
    });
    expect(renderStreamJsonLine(line)).toBe("> Read /a");
  });

  it("user tool_result with is_error returns error line", () => {
    const line = JSON.stringify({
      type: "user",
      message: { content: [{ type: "tool_result", is_error: true, content: "oops" }] },
    });
    expect(renderStreamJsonLine(line)).toBe("! oops");
  });

  it("user tool_result without error returns null (drop)", () => {
    const line = JSON.stringify({
      type: "user",
      message: { content: [{ type: "tool_result", content: "ok" }] },
    });
    expect(renderStreamJsonLine(line)).toBeNull();
  });

  it("result returns summary", () => {
    const line = JSON.stringify({
      type: "result",
      num_turns: 2,
      duration_ms: 500,
      total_cost_usd: 0.01,
      is_error: false,
    });
    const out = renderStreamJsonLine(line);
    expect(out).toContain("done");
    expect(out).toContain("turns=2");
    expect(out).toContain("dur=500ms");
    expect(out).toContain("cost=$0.01");
  });

  it("result with is_error shows FAILED", () => {
    const line = JSON.stringify({ type: "result", is_error: true });
    expect(renderStreamJsonLine(line)).toContain("FAILED");
  });
});
