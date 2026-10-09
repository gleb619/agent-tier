import type { NotifyAdapter, NotifyEvent } from '../types';
import { buildPromptSuffix } from '../prompt';

const TEXT_LIMIT = 500;

function truncate(s: string, n: number): string {
  if (s.length <= n) return s;
  return s.slice(0, n) + '…';
}

interface KiroUpdate {
  sessionUpdate?: string;
  content?: { type?: string; text?: string };
}

/**
 * kiro: `kiro-cli chat --no-interactive --trust-all-tools <prompt>` with
 * `--agent-engine v2 --output-format stream-json` inserted after `chat`.
 * Emits one JSONL line per event:
 *   {type:"runStarted", data:{payloadSchema,acpProtocolVersion,engine}}
 *   {type:"metadata", data:{sessionId,contextUsagePercentage,meteringUsage,...}}
 *   {type:"sessionUpdate", data:{sessionId, update:{sessionUpdate, content:{type:"text", text}}}}
 *   {type:"runFinished", data:{sessionId, status, stopReason, finalText, finalTextTruncated}}
 */
export function makeKiroAdapter(): NotifyAdapter {
  return {
    name: 'kiro',
    promptSuffix(ctx) {
      return buildPromptSuffix(ctx);
    },
    transformArgs(_ctx, baseArgs) {
      // baseArgs: ['chat', '--no-interactive', '--trust-all-tools', prompt]
      // splice engine + stream-json right after the subcommand.
      const out = baseArgs.slice();
      const insertAt = 1;
      out.splice(insertAt, 0, '--agent-engine', 'v2', '--output-format', 'stream-json');
      return out;
    },
    parseLine(line: string): Array<Omit<NotifyEvent, 'runId' | 'agent' | 'ts' | 'seq'>> {
      try {
        const trimmed = line.trim();
        if (!trimmed || trimmed[0] !== '{') return [];
        let payload: Record<string, unknown>;
        try {
          payload = JSON.parse(trimmed) as Record<string, unknown>;
        } catch {
          return [];
        }
        const t = payload.type;
        if (t === 'runStarted') {
          const data = (payload.data ?? {}) as Record<string, unknown>;
          const engine = typeof data.engine === 'string' ? data.engine : '';
          return [{
            type: 'progress',
            text: engine ? `session started (engine=${engine})` : 'session started',
          }];
        }
        if (t === 'sessionUpdate') {
          const data = (payload.data ?? {}) as Record<string, unknown>;
          const update = (data.update ?? {}) as KiroUpdate;
          if (update.sessionUpdate !== 'agent_message_chunk') return [];
          const content = update.content;
          const text = content && typeof content.text === 'string' ? content.text : '';
          if (!text) return [];
          return [{ type: 'message', text: truncate(text, TEXT_LIMIT) }];
        }
        if (t === 'runFinished') {
          const data = (payload.data ?? {}) as Record<string, unknown>;
          const status = typeof data.status === 'string' ? data.status : 'done';
          const stopReason = typeof data.stopReason === 'string' ? data.stopReason : '';
          const finalText = typeof data.finalText === 'string' ? data.finalText : '';
          const text = stopReason ? `session ${status} (${stopReason})` : `session ${status}`;
          const events: Array<Omit<NotifyEvent, 'runId' | 'agent' | 'ts' | 'seq'>> = [
            { type: 'progress', text },
          ];
          if (finalText) {
            events.push({ type: 'message', text: truncate(finalText, TEXT_LIMIT) });
          }
          return events;
        }
        // metadata, runError, anything else: ignore
        return [];
      } catch {
        return [];
      }
    },
  };
}
