import { createSignal } from 'solid-js';
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { resolveStateDir, getStateFilePath } from '../../state-dir';

const [focusZone, setFocusZone] = createSignal<0 | 1 | 2 | 3 | 4>(4);

export { focusZone, setFocusZone };

export function loadUIState(): void {
  try {
    const stateDir = resolveStateDir();
    const path = getStateFilePath(stateDir);
    const data = JSON.parse(readFileSync(path, 'utf8')) as { tui?: { focusZone?: number } };
    if (typeof data.tui?.focusZone === 'number') {
      const zone = Math.max(0, Math.min(4, data.tui.focusZone));
      setFocusZone(zone as 0 | 1 | 2 | 3 | 4);
    }
  } catch {
    // ignore missing or malformed state.json
  }
}

export function saveUIState(zone: number): void {
  try {
    const stateDir = resolveStateDir();
    const path = getStateFilePath(stateDir);
    let data: Record<string, unknown> = {};
    try {
      data = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
    } catch {
      // ignore missing or malformed state.json
    }
    const tui = (data.tui as Record<string, unknown> | undefined) ?? {};
    tui.focusZone = zone;
    data.tui = tui;
    mkdirSync(stateDir, { recursive: true });
    writeFileSync(path, JSON.stringify(data, null, 2), 'utf8');
  } catch {
    // ignore write errors
  }
}
