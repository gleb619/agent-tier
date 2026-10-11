import { buildPromptSuffix } from "../prompt";
import type { NotifyAdapter, NotifyEvent } from "../types";

const TEXT_LIMIT = 500;

function truncate(s: string, n: number): string {
  if (s.length <= n) return s;
  return `${s.slice(0, n)}…`;
}

function summarizeInput(_name: string, input: unknown): string {
  if (!input || typeof input !== "object") return "";
  const obj = input as Record<string, unknown>;
  const candidates: Array<[string, string]> = [
    ["file_path", String(obj.file_path ?? "")],
    ["path", String(obj.path ?? "")],
    ["pattern", String(obj.pattern ?? "")],
    ["command", String(obj.command ?? "")],
    ["query", String(obj.query ?? "")],
    ["url", String(obj.url ?? "")],
    ["description", String(obj.description ?? "")],
  ];
  for (const [, v] of candidates) {
    if (v) return v;
  }
  try {
    const json = JSON.stringify(input);
    if (json.length <= 80) return json;
    return `${json.slice(0, 77)}…`;
  } catch {
    return "";
  }
}

function extractSystemModel(payload: Record<string, unknown>): string | undefined {
  const candidates: unknown[] = [payload.model, (payload as { message?: { model?: string } }).message?.model];
  for (const c of candidates) {
    if (typeof c === "string" && c) return c;
  }
  return undefined;
}

function extractTextBlocks(content: unknown): string[] {
  if (!Array.isArray(content)) return [];
  return content
    .filter(
      (b): b is { type: string; text: string } =>
        !!b && typeof b === "object" && (b as { type?: string }).type === "text",
    )
    .map((b) => String(b.text ?? ""))
    .filter((t) => t.length > 0);
}

function extractToolUses(content: unknown): Array<{ name: string; input: unknown }> {
  if (!Array.isArray(content)) return [];
  const out: Array<{ name: string; input: unknown }> = [];
  for (const b of content) {
    if (!b || typeof b !== "object") continue;
    const block = b as { type?: string; name?: string; input?: unknown };
    if (block.type === "tool_use" && typeof block.name === "string") {
      out.push({ name: block.name, input: block.input });
    }
  }
  return out;
}

function extractToolResults(content: unknown): Array<{ is_error: boolean; content: string }> {
  if (!Array.isArray(content)) return [];
  const out: Array<{ is_error: boolean; content: string }> = [];
  for (const b of content) {
    if (!b || typeof b !== "object") continue;
    const block = b as { type?: string; is_error?: unknown; content?: unknown };
    if (block.type !== "tool_result") continue;
    const c = block.content;
    const text =
      typeof c === "string"
        ? c
        : Array.isArray(c)
          ? c
              .map((x) =>
                x && typeof x === "object" && "text" in (x as object)
                  ? String((x as { text?: unknown }).text ?? "")
                  : "",
              )
              .join("\n")
          : "";
    out.push({ is_error: !!block.is_error, content: text });
  }
  return out;
}

export function makeClaudeAdapter(name: string): NotifyAdapter {
  return {
    name,
    args() {
      return ["--output-format", "stream-json", "--verbose"];
    },
    promptSuffix(ctx) {
      return buildPromptSuffix(ctx);
    },
    parseLine(line: string): Array<Omit<NotifyEvent, "runId" | "agent" | "ts" | "seq">> {
      try {
        const trimmed = line.trim();
        if (trimmed?.[0] !== "{") return [];
        let payload: Record<string, unknown>;
        try {
          payload = JSON.parse(trimmed) as Record<string, unknown>;
        } catch {
          return [];
        }
        const t = payload.type;
        if (t === "system") {
          const model = extractSystemModel(payload);
          const data: Record<string, unknown> = {};
          if (model) data.model = model;
          return [{ type: "progress", text: "session started", data }];
        }
        if (t === "assistant") {
          const msg = payload.message as { content?: unknown } | undefined;
          const content = msg?.content;
          const events: Array<Omit<NotifyEvent, "runId" | "agent" | "ts" | "seq">> = [];
          for (const text of extractTextBlocks(content)) {
            events.push({ type: "message", text: truncate(text, TEXT_LIMIT) });
          }
          for (const tu of extractToolUses(content)) {
            const summary = summarizeInput(tu.name, tu.input);
            const label = summary ? `${tu.name} ${summary}` : tu.name;
            events.push({
              type: "tool",
              text: truncate(label, TEXT_LIMIT),
              data: { name: tu.name },
            });
          }
          return events;
        }
        if (t === "user") {
          const msg = payload.message as { content?: unknown } | undefined;
          const results = extractToolResults(msg?.content);
          const events: Array<Omit<NotifyEvent, "runId" | "agent" | "ts" | "seq">> = [];
          for (const r of results) {
            if (r.is_error) {
              events.push({
                type: "error",
                text: truncate(r.content || "tool error", TEXT_LIMIT),
              });
            }
          }
          return events;
        }
        if (t === "result") {
          const data: Record<string, unknown> = {};
          for (const k of ["duration_ms", "num_turns", "total_cost_usd", "is_error"] as const) {
            if (k in payload) data[k] = payload[k];
          }
          return [{ type: "progress", text: "session finished", data }];
        }
        return [];
      } catch {
        return [];
      }
    },
  };
}
