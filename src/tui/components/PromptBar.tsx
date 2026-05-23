/** @jsxImportSource @opentui/solid */
import { createSignal, createMemo } from "solid-js";
import { tier, agent, mode, orchestrate, retries } from "../store/settings";

export interface PromptSubmitOpts {
  tier: 1 | 2 | 3;
  agent: string;
  mode: "stream" | "detached";
  orchestrate: boolean;
  retries: number;
}

export interface PromptBarProps {
  focused: boolean;
  onSubmit: (prompt: string, opts: PromptSubmitOpts) => void;
}

export function PromptBar(props: PromptBarProps): JSX.Element {
  const [prompt, setPrompt] = createSignal("");

  const currentOpts = createMemo(
    (): PromptSubmitOpts => ({
      tier: tier(),
      agent: agent(),
      mode: mode(),
      orchestrate: orchestrate(),
      retries: retries(),
    })
  );

  return (
    <box
      border
      borderStyle="single"
      borderColor={props.focused ? "#00aaff" : "#555555"}
      flexDirection="column"
      padding={1}
      gap={1}
    >
      <input
        value={prompt()}
        placeholder="Enter prompt and press Enter to launch agent..."
        focused={props.focused}
        onInput={(v) => setPrompt(v)}
        onSubmit={(v) => {
          if (v.trim()) {
            props.onSubmit(v.trim(), currentOpts());
            setPrompt("");
          }
        }}
        width="100%"
      />

      <box flexDirection="row" gap={2}>
        <text content={"Tier:[" + tier() + "]"} fg="#aaaaaa" />
        <text content={"Agent:[" + agent() + "]"} fg="#aaaaaa" />
        <text content={"Mode:[" + mode() + "]"} fg="#aaaaaa" />
        <text
          content={"Orch:[" + (orchestrate() ? "on" : "off") + "]"}
          fg={orchestrate() ? "#00ff88" : "#aaaaaa"}
        />
        <text content={"Retries:[" + retries() + "]"} fg="#aaaaaa" />
      </box>

      <box flexDirection="row" gap={2}>
        <text content="^T tier" fg="#555555" />
        <text content="^A agent" fg="#555555" />
        <text content="^M mode" fg="#555555" />
        <text content="^O orch" fg="#555555" />
        <text content="^N retries" fg="#555555" />
      </box>
    </box>
  );
}