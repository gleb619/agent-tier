import { For } from 'solid-js';
import type { JSX } from 'solid-js';
import {
  agent,
  cycleAgent,
  cycleMode,
  cycleRetries,
  cycleTier,
  mode,
  retries,
  tier,
} from '../../tui/store/settings';
import { autoRefresh, setAutoRefresh } from '../../tui/store/log';
import { settingsRow } from '../store/ui';

export interface SettingAction {
  label: string;
  value: () => string;
  act: () => void;
}

/**
 * One row per editable preference. Tier/agent/mode/retries persist through the
 * classic settings store (`saveSettings` inside each `cycle*`); auto-refresh is
 * runtime-only state in the log store.
 */
export const SETTING_ACTIONS: SettingAction[] = [
  { label: 'Default tier', value: () => String(tier()), act: cycleTier },
  { label: 'Default agent', value: () => agent(), act: cycleAgent },
  { label: 'Run mode', value: () => mode(), act: cycleMode },
  { label: 'Retries', value: () => String(retries()), act: cycleRetries },
  { label: 'Auto-refresh', value: () => (autoRefresh() ? 'ON' : 'OFF'), act: () => setAutoRefresh(!autoRefresh()) },
];

export const SETTINGS_ROW_COUNT = SETTING_ACTIONS.length;

/** Clamp a settings cursor index into range. */
export function clampRow(index: number): number {
  return Math.max(0, Math.min(SETTINGS_ROW_COUNT - 1, index));
}

export function Settings(props: { focused: boolean }): JSX.Element {
  return (
    <box
      title="Settings"
      border
      borderStyle="single"
      borderColor={props.focused ? '#00aaff' : '#555555'}
      focused={props.focused}
      flexDirection="column"
      flexGrow={1}
      padding={1}
      gap={1}
    >
      <text content="↑/↓ select   Enter change" fg="#484f58" />

      <For each={SETTING_ACTIONS}>
        {(row, i) => {
          const active = i() === settingsRow();
          return (
            <box
              flexDirection="row"
              gap={2}
              paddingX={1}
              backgroundColor={active ? '#1c2128' : undefined}
              onMouseDown={() => row.act()}
            >
              <text fg={active ? '#58a6ff' : '#8b949e'}>
                {active ? '▶ ' : '  '}{row.label.padEnd(16)}
              </text>
              <text fg="#c9d1d9" content={row.value()} />
            </box>
          );
        }}
      </For>

      <text
        content="Defaults are stored under tui.settings in at's state file."
        fg="#484f58"
      />
    </box>
  );
}
