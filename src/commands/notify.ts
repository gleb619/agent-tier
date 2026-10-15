import type { Command } from "commander";
import { DISCUSS_DISABLED_MSG, discussEnabled } from "../discuss-flag";
import { postDiscussEntry } from "./discuss-helpers";

/**
 * `at notify <runId> <msg...>` — kept as an alias for `at discuss note`.
 * Same effect: appends a kind:'note' entry to the discuss thread (or POSTs to
 * the hub when AT_SSE_URL is set).
 */
export function registerNotifyCommand(program: Command): void {
  program
    .command("notify <runId> <message...>")
    .description("Alias for `at discuss note`: post a one-way progress note")
    .action(async (runId: string, messageParts: string[]) => {
      if (!discussEnabled()) {
        console.error(DISCUSS_DISABLED_MSG);
        process.exit(2);
      }
      const text = messageParts.join(" ");
      await postDiscussEntry(runId, { from: "agent", kind: "note", text });
    });
}
