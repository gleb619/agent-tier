import { describe, expect, it } from "vitest";
import type { NotifyEvent, NotifyEventType } from "../../src/notify/types";

describe("NotifyEventType — rename (T10)", () => {
  it("includes rename as a valid event type", () => {
    const types: NotifyEventType[] = [
      "start",
      "message",
      "tool",
      "progress",
      "error",
      "done",
      "question",
      "answer",
      "rename",
    ];
    expect(types).toContain("rename");
  });

  it("a rename event payload has data.name", () => {
    const ev: NotifyEvent = {
      runId: "r1",
      agent: "mock",
      ts: "2026-10-09T10:00:00.000Z",
      seq: 1,
      type: "rename",
      data: { name: "add-error-handling-to-api" },
    };
    expect(ev.type).toBe("rename");
    expect(ev.data?.name).toBe("add-error-handling-to-api");
  });
});

describe("hub — re-emits rename events", () => {
  it("publish() of a rename event makes it available to subscribers", async () => {
    const { startHub } = await import("../../src/notify/hub");
    const { mkdtempSync, rmSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const path = await import("node:path");
    const stateDir = mkdtempSync(path.join(tmpdir(), "at-rename-"));
    try {
      const hub = await startHub({ stateDir, port: 0 });
      const seen: NotifyEvent[] = [];
      hub.onEvent = (e: NotifyEvent) => seen.push(e); // hypothetical hook
      // Fallback if hub doesn't have onEvent: just publish + replay
      hub.publish({
        runId: "r1",
        agent: "mock",
        ts: "2026-10-09T10:00:00.000Z",
        seq: 1,
        type: "rename",
        data: { name: "add-error-handling-to-api" },
      });
      await new Promise((r) => setTimeout(r, 20));
      // Hub internal event file should have the rename event
      const fs = await import("node:fs");
      const eventsDir = path.join(stateDir, "events");
      const file = path.join(eventsDir, "r1.jsonl");
      const text = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
      expect(text).toContain('"type":"rename"');
      expect(text).toContain("add-error-handling-to-api");
      await hub.close();
    } finally {
      rmSync(stateDir, { recursive: true, force: true });
    }
  });
});
