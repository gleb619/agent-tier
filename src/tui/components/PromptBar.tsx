import { createSignal, createMemo, createEffect, onCleanup } from "solid-js";
import type { JSX } from "solid-js";
import { tier, agent, mode, retries, cycleTier, cycleAgent, cycleMode, cycleRetries } from "../store/settings";

export interface PromptSubmitOpts {
  tier: 1 | 2 | 3 | 4;
  agent: string;
  mode: "stream" | "detached";
  retries: number;
}

export interface PromptBarProps {
  focused: boolean;
  onSubmit: (prompt: string, opts: PromptSubmitOpts) => void;
}

const SPINNER_FRAMES = ["|", "/", "-", "\\"];

export function PromptBar(props: PromptBarProps): JSX.Element {
  const [prompt, setPrompt] = createSignal("");
  const [submitting, setSubmitting] = createSignal(false);
  const [spinnerFrame, setSpinnerFrame] = createSignal(0);

  const currentOpts = createMemo(
    (): PromptSubmitOpts => ({
      tier: tier(),
      agent: agent(),
      mode: mode(),
      retries: retries(),
    })
  );

  createEffect(() => {
    if (submitting()) {
      const interval = setInterval(() => {
        setSpinnerFrame((f) => (f + 1) % SPINNER_FRAMES.length);
      }, 200);
      onCleanup(() => clearInterval(interval));
    }
  });

  return (
    <box
      border
      borderStyle="single"
      borderColor={props.focused ? "#00aaff" : "#555555"}
      flexDirection="column"
      padding={1}
      gap={1}
    >
      {submitting() ? (
        <text content={SPINNER_FRAMES[spinnerFrame()] + " launching agent..."} fg="#00aaff" />
      ) : (
        <input
          value={prompt()}
          placeholder={props.focused ? "⚡︎ Enter prompt..." : "Enter prompt and press Enter to launch agent..."}
          focused={props.focused}
          onInput={(v) => setPrompt(v)}
          onSubmit={(v) => {
            if (submitting()) return;
            if (typeof v !== 'string') return;
            const trimmed = v.trim();
            if (trimmed.length < 3) return;
            props.onSubmit(trimmed, currentOpts());
            setPrompt("");
            setSubmitting(true);
            setTimeout(() => setSubmitting(false), 3000);
          }}
          width="100%"
        />
      )}

      <box flexDirection="row" gap={2}>
        <text content={"Tier:[" + tier() + "]"} fg="#aaaaaa" onMouseDown={cycleTier} />
        <text content={"Agent:[" + agent() + "]"} fg="#aaaaaa" onMouseDown={cycleAgent} />
        <text content={"Mode:[" + mode() + "]"} fg="#aaaaaa" onMouseDown={cycleMode} />
        <text content={"Retries:[" + retries() + "]"} fg="#aaaaaa" onMouseDown={cycleRetries} />
        {prompt().trim().length > 0 && prompt().trim().length < 3 && !submitting() && (
          <text content="min 3 characters" fg="#ffaa00" />
        )}
      </box>
    </box>
  );
}
