import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { getAdapter } from "../../src/notify";
import { makeClineAdapter } from "../../src/notify/adapters/cline";

const FIXTURES = path.join(__dirname, "fixtures");

function loadFixture(name: string): string[] {
  return readFileSync(path.join(FIXTURES, name), "utf8").split("\n").filter(Boolean);
}

describe("cline adapter", () => {
  const adapter = makeClineAdapter();

  it("promptSuffix carries the cline-specific host-channel block", () => {
    const suffix = adapter.promptSuffix?.({ runId: "r1", eventFile: "/tmp/x" }) ?? "";
    // Cline's suffix uses the imperative form with an inlined command, not
    // the shared `Host channel:` prose — so check for the cline-specific
    // shape.
    expect(suffix).toContain("discuss ask");
    expect(suffix).toContain("-R r1");
    expect(suffix).toContain("color.txt");
  });

  it("promptSuffix inlines absolute AT_BIN + stateDir + runId when no shim", () => {
    const suffix =
      adapter.promptSuffix?.({
        runId: "abc-123",
        eventFile: "/tmp/x",
        atBin: "'/usr/bin/node' '/repo/dist/cli.js'",
        stateDir: "/tmp/sb/state",
      }) ?? "";
    // No shim: the suffix falls back to the absolute `at` form with the
    // state dir + run id inlined.
    expect(suffix).toContain("'/usr/bin/node' '/repo/dist/cli.js' discuss ask");
    expect(suffix).toContain("-R abc-123");
    expect(suffix).toContain("--state-dir /tmp/sb/state");
  });

  it("promptSuffix falls back to inline $AT_BIN form when no shim is provided", () => {
    const suffix = adapter.promptSuffix?.({ runId: "r1", eventFile: "/tmp/x" }) ?? "";
    // Non-SSE / pre-shim path: the suffix still inlines the absolute `at`
    // path and -R, so the LLM has the flags it needs.
    expect(suffix).toContain("$AT_BIN discuss ask");
    expect(suffix).toContain("-R r1");
  });

  it("promptSuffix uses the per-run shim path when provided", () => {
    const suffix =
      adapter.promptSuffix?.({
        runId: "r1",
        eventFile: "/tmp/x",
        hostChannelShim: "/tmp/sb/.at-host-channel.sh",
      }) ?? "";
    // The shim is the only way the LLM can reach the host channel when
    // cline's hub daemon has a stale AT_STATE_DIR / AT_RUN_ID — its path
    // is the LITERAL command the LLM is told to run.
    expect(suffix).toContain("/tmp/sb/.at-host-channel.sh discuss ask");
    expect(suffix).toContain("-R r1");
    // The shim form does NOT inline --state-dir — the shim sets it via env.
    expect(suffix).not.toContain("--state-dir");
  });

  it("promptSuffix carries the stop-after-color.txt rule", () => {
    const suffix = adapter.promptSuffix?.({ runId: "r1", eventFile: "/tmp/x" }) ?? "";
    expect(suffix).toContain("color.txt");
    expect(suffix).toMatch(/do not poll|no follow-up|improvise/i);
  });

  it("agent_event iteration_start maps to progress", () => {
    const events = adapter.parseLine!(
      JSON.stringify({
        ts: "2026-01-01T00:00:00Z",
        type: "agent_event",
        event: { type: "iteration_start", iteration: 1 },
      }),
    );
    expect(events).toEqual([{ type: "progress", text: "session started" }]);
  });

  it("agent_event content_start text uses accumulated", () => {
    const events = adapter.parseLine!(
      JSON.stringify({
        ts: "2026-01-01T00:00:00Z",
        type: "agent_event",
        event: { type: "content_start", contentType: "text", text: "Hi", accumulated: "Hi there" },
      }),
    );
    expect(events).toEqual([{ type: "message", text: "Hi there" }]);
  });

  it("agent_event content_start reasoning returns empty", () => {
    const events = adapter.parseLine!(
      JSON.stringify({
        ts: "2026-01-01T00:00:00Z",
        type: "agent_event",
        event: { type: "content_start", contentType: "reasoning", text: "thinking..." },
      }),
    );
    expect(events).toEqual([]);
  });

  it("agent_event tool_start maps to tool", () => {
    const events = adapter.parseLine!(
      JSON.stringify({
        ts: "2026-01-01T00:00:00Z",
        type: "agent_event",
        event: { type: "tool_start", text: "Bash ls" },
      }),
    );
    expect(events).toEqual([{ type: "tool", text: "Bash ls" }]);
  });

  it("agent_event done maps to progress", () => {
    const events = adapter.parseLine!(
      JSON.stringify({
        ts: "2026-01-01T00:00:00Z",
        type: "agent_event",
        event: { type: "done", reason: "completed" },
      }),
    );
    expect(events).toEqual([{ type: "progress", text: "session done (completed)" }]);
  });

  it("run_result maps to progress and message", () => {
    const events = adapter.parseLine!(
      JSON.stringify({
        ts: "2026-01-01T00:00:00Z",
        type: "run_result",
        finishReason: "completed",
        iterations: 1,
        durationMs: 1000,
        text: "final answer",
      }),
    );
    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({ type: "progress" });
    expect(events[0].text).toContain("completed");
    expect(events[1]).toEqual({ type: "message", text: "final answer" });
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

  it("fixture file parses and produces expected event types", () => {
    const lines = loadFixture("cline.jsonl");
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

  it("getAdapter returns the cline adapter for cline agent", () => {
    const a = getAdapter("cline");
    expect(a.name).toBe("cline");
  });

  it("promptPrefix inlines AT_BIN command and includes runId and stateDir", () => {
    const adapter = makeClineAdapter();
    const atBin = "/usr/local/bin/at";
    const ctx = { runId: "test-run-123", eventFile: "/tmp/events/test-run-123.jsonl", stateDir: "/tmp/.at", atBin };
    const prefix = adapter.promptPrefix?.(ctx) ?? "";
    expect(prefix).toContain(atBin);
    expect(prefix).toContain("test-run-123");
    expect(prefix).toContain("/tmp/.at");
  });

  it("promptSuffix inlines AT_BIN command and contains no $VARS", () => {
    const adapter = makeClineAdapter();
    const atBin = "/usr/local/bin/at";
    const ctx = { runId: "test-run-456", eventFile: "/tmp/events/test-run-456.jsonl", stateDir: "/tmp/.at", atBin };
    const suffix = adapter.promptSuffix?.(ctx) ?? "";
    expect(suffix).not.toMatch(/\$/);
    expect(suffix).toContain(atBin);
    expect(suffix).toContain("test-run-456");
    expect(suffix).toContain("/tmp/.at");
  });

  it("promptPrefix and promptSuffix both contain AT_BIN with same value", () => {
    const adapter = makeClineAdapter();
    const ctx = {
      runId: "run-789",
      eventFile: "/tmp/events/run-789.jsonl",
      stateDir: "/tmp/.at",
      atBin: "/usr/bin/at",
    };
    const prefix = adapter.promptPrefix?.(ctx) ?? "";
    const suffix = adapter.promptSuffix?.(ctx) ?? "";
    expect(prefix).toContain("/usr/bin/at");
    expect(suffix).toContain("/usr/bin/at");
  });
});
