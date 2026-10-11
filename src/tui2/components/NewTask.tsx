import type { TextareaRenderable } from "@opentui/core";
import type { JSX } from "solid-js";
import { createSignal, Show } from "solid-js";
import { type PromptSubmitOpts, submitPrompt } from "../../tui/launch";
import { agent, cycleAgent, cycleMode, cycleRetries, cycleTier, mode, retries, tier } from "../../tui/store/settings";

const MIN_PROMPT_LENGTH = 3;

export function currentOpts(): PromptSubmitOpts {
  return { tier: tier(), agent: agent(), mode: mode(), retries: retries() };
}

/** Validate a raw prompt for submission; returns the trimmed prompt or an error message. */
export function validatePrompt(raw: string): { prompt?: string; error?: string } {
  const trimmed = raw.trim();
  if (trimmed.length < MIN_PROMPT_LENGTH) {
    return { error: `min ${MIN_PROMPT_LENGTH} characters` };
  }
  return { prompt: trimmed };
}

interface SelectorProps {
  label: string;
  value: string;
  hotkey: string;
  onCycle: () => void;
}

function Selector(props: SelectorProps): JSX.Element {
  return (
    <box flexDirection="row" gap={1} paddingX={1} onMouseDown={props.onCycle}>
      <text fg="#8b949e" content={`${props.label}:`} />
      <text fg="#58a6ff" content={`${props.value}`} />
      <text fg="#484f58" content={`[^${props.hotkey}]`} />
    </box>
  );
}

export function NewTask(props: { focused: boolean }): JSX.Element {
  const [status, setStatus] = createSignal<{ text: string; error: boolean }>({ text: "", error: false });
  let field: TextareaRenderable | undefined;

  function submit(): void {
    const result = validatePrompt(field ? field.plainText : "");
    if (result.error) {
      setStatus({ text: result.error, error: true });
      return;
    }
    const opts = currentOpts();
    submitPrompt(result.prompt as string, opts);
    field?.clear();
    setStatus({ text: `launching: tier ${opts.tier} · ${opts.agent} · ${opts.mode}`, error: false });
  }

  return (
    <box
      title="New Task"
      border
      borderStyle="single"
      borderColor={props.focused ? "#00ddff" : "#555555"}
      focused={props.focused}
      flexDirection="column"
      flexGrow={1}
      padding={1}
      gap={1}
    >
      <text fg="#58a6ff">
        <b>Prompt</b>
      </text>

      <textarea
        ref={(el: TextareaRenderable) => {
          field = el;
        }}
        placeholder="Describe the task for the agent…"
        focused={props.focused}
        flexGrow={1}
        minHeight={5}
        wrapMode="word"
        onSubmit={() => submit()}
        keyBindings={[
          // Enter is the primary action here (the classic PromptBar behaviour);
          // Shift+Enter keeps multi-line prompts reachable.
          { name: "return", action: "submit" },
          { name: "kpenter", action: "submit" },
          { name: "return", shift: true, action: "newline" },
          { name: "linefeed", action: "newline" },
        ]}
      />

      <box flexDirection="row" gap={3}>
        <Selector label="Tier" value={String(tier())} hotkey="T" onCycle={cycleTier} />
        <Selector label="Agent" value={agent()} hotkey="A" onCycle={cycleAgent} />
        <Selector label="Mode" value={mode()} hotkey="O" onCycle={cycleMode} />
        <Selector label="Retries" value={String(retries())} hotkey="N" onCycle={cycleRetries} />
      </box>

      <Show when={status().text !== ""}>
        <text content={status().text} fg={status().error ? "#d29922" : "#3fb950"} />
      </Show>
    </box>
  );
}
