import { buildPromptSuffix } from "../prompt";
import type { NotifyAdapter, NotifyEvent } from "../types";

const TEXT_LIMIT = 500;

function truncate(s: string, n: number): string {
  if (s.length <= n) return s;
  return `${s.slice(0, n)}…`;
}

function summarizeInput(input: unknown): string {
  if (!input || typeof input !== "object") return "";
  const obj = input as Record<string, unknown>;
  for (const k of ["file_path", "path", "pattern", "command", "query", "url", "description"]) {
    const v = obj[k];
    if (typeof v === "string" && v) return v;
  }
  try {
    const json = JSON.stringify(input);
    if (json.length <= 80) return json;
    return `${json.slice(0, 77)}…`;
  } catch {
    return "";
  }
}

function extractTextBlocks(content: unknown): string[] {
  if (!Array.isArray(content)) return [];
  const out: string[] = [];
  for (const b of content) {
    if (!b || typeof b !== "object") continue;
    const block = b as { type?: string; text?: unknown };
    if (block.type === "text" && typeof block.text === "string" && block.text) {
      out.push(block.text);
    }
  }
  return out;
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

function extractErrorToolResults(content: unknown): string[] {
  if (!Array.isArray(content)) return [];
  const out: string[] = [];
  for (const b of content) {
    if (!b || typeof b !== "object") continue;
    const block = b as { type?: string; is_error?: unknown; content?: unknown };
    if (block.type !== "tool_result" || !block.is_error) continue;
    const c = block.content;
    if (typeof c === "string") out.push(c);
  }
  return out;
}

function getMessage(payload: Record<string, unknown>): Record<string, unknown> | undefined {
  const m = payload.message;
  if (m && typeof m === "object") return m as Record<string, unknown>;
  return undefined;
}

function getContent(payload: Record<string, unknown>): unknown {
  return getMessage(payload)?.content;
}

function pluckString(obj: Record<string, unknown>, keys: string[]): string | undefined {
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === "string" && v) return v;
  }
  return undefined;
}

export function makeQwenAdapter(): NotifyAdapter {
  return {
    name: "qwen",
    promptSuffix(ctx) {
      return buildPromptSuffix(ctx);
    },
    // qwen flag order: <flags...> --output-format stream-json <prompt>
    // baseArgs is something like ['-y', prompt] — keep the head, insert the flag
    // before the trailing prompt.
    transformArgs(_ctx, baseArgs) {
      const out = baseArgs.slice(0, -1);
      out.push("--output-format", "stream-json");
      out.push(baseArgs[baseArgs.length - 1]!);
      return out;
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
          const model = pluckString(payload, ["model"]);
          const sid = pluckString(payload, ["session_id"]);
          const data: Record<string, unknown> = {};
          if (model) data.model = model;
          if (sid) data.session_id = sid;
          return [{ type: "progress", text: model ? `session started (model=${model})` : "session started", data }];
        }
        if (t === "assistant") {
          const content = getContent(payload);
          const events: Array<Omit<NotifyEvent, "runId" | "agent" | "ts" | "seq">> = [];
          for (const text of extractTextBlocks(content)) {
            events.push({ type: "message", text: truncate(text, TEXT_LIMIT) });
          }
          for (const tu of extractToolUses(content)) {
            const summary = summarizeInput(tu.input);
            const label = summary ? `${tu.name} ${summary}` : tu.name;
            events.push({ type: "tool", text: truncate(label, TEXT_LIMIT), data: { name: tu.name } });
          }
          return events;
        }
        if (t === "user") {
          const content = getContent(payload);
          const errors = extractErrorToolResults(content);
          if (errors.length === 0) return [];
          return errors.map((e) => ({ type: "error", text: truncate(e, TEXT_LIMIT) }));
        }
        if (t === "result") {
          const parts: string[] = [];
          if ("num_turns" in payload) parts.push(`turns=${payload.num_turns}`);
          if ("duration_ms" in payload) parts.push(`dur=${payload.duration_ms}ms`);
          if ("total_cost_usd" in payload) parts.push(`cost=$${payload.total_cost_usd}`);
          const data: Record<string, unknown> = {};
          if ("is_error" in payload) data.is_error = payload.is_error;
          if ("usage" in payload) data.usage = payload.usage;
          const status = payload.is_error ? "FAILED" : "done";
          const events: Array<Omit<NotifyEvent, "runId" | "agent" | "ts" | "seq">> = [
            { type: "progress", text: `[result] ${status} ${parts.join(" ")}`.trim(), data },
          ];
          const resultText = payload.result;
          if (typeof resultText === "string" && resultText) {
            events.push({ type: "message", text: truncate(resultText, TEXT_LIMIT) });
          }
          return events;
        }
        return [];
      } catch {
        return [];
      }
    },
  };
}
