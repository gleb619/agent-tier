import { For, Switch, Match } from "solid-js";
import type { JSX } from "solid-js";

interface HotkeyBarProps {
  focusZone: 0 | 1 | 2 | 3 | 4;
}

interface HotkeyItem {
  key: string;
  desc: string;
}

function getHotkeysForZone(zone: number): HotkeyItem[] {
  switch (zone) {
    case 0: // sidebar filter
    case 1: // sidebar list
      return [
        { key: "↑↓", desc: "select" },
        { key: "Tab", desc: "input/list" },
        { key: "^K", desc: "kill" },
        { key: "^E", desc: "retry" },
        { key: "^R", desc: "refresh" },
        { key: "^]", desc: "panels" },
        { key: "^C", desc: "exit" },
      ];
    case 2: // log filter
    case 3: // log scroll
      return [
        { key: "↑↓", desc: "scroll" },
        { key: "Tab", desc: "scroll/filter" },
        { key: "^H", desc: "head" },
        { key: "^T", desc: "tail" },
        { key: "^R", desc: "refresh" },
        { key: "^L", desc: "auto" },
        { key: "^]", desc: "panels" },
        { key: "^C", desc: "exit" },
      ];
    case 4: // prompt bar
      return [
        { key: "Enter", desc: "submit" },
        { key: "^T", desc: "tier" },
        { key: "^A", desc: "agent" },
        { key: "^O", desc: "mode" },
        { key: "^N", desc: "retries" },
        { key: "^]", desc: "panels" },
        { key: "^C", desc: "exit" },
      ];
    default:
      return [];
  }
}

export function HotkeyBar(props: HotkeyBarProps): JSX.Element {
  const hotkeys = () => getHotkeysForZone(props.focusZone);

  return (
    <box
      flexDirection="row"
      padding={1}
      paddingY={0}
      gap={3}
      border
      borderStyle="single"
      borderColor="#21262d"
    >
      <For each={hotkeys()}>
        {(item) => (
          <box flexDirection="row" gap={0}>
            <text content={"[" + item.key + "]"} fg="#58a6ff" />
            <text content={item.desc} fg="#8b949e" />
          </box>
        )}
      </For>
    </box>
  );
}
