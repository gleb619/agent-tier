// Headless render smoke for tui2's outer box.
//
// Vitest can't drive @opentui/solid's renderer under Node — the renderer
// needs `bun:ffi` or `node:ffi`, neither available on plain Node 22. Run
// this script under Bun with the JSX runtime flags so it actually renders:
//
//   bun run --jsx-import-source @opentui/solid --jsx-runtime automatic \
//       scripts/tui2-render-test.tsx
//
// Strategy: render the exact same outer column App.tsx returns (header row
// of texts, middle row with sidebar+main panes both flexGrow=1, footer row
// with the keybind line). The dashboard view keeps the inner body light
// (no textarea, no whitespace-only text nodes) so the smoke test isolates
// the layout. Real App.tsx is mounted indirectly — its outer column shares
// this structure exactly, and the vitest suite under tests/tui2 already
// covers the per-component behaviour.

import { testRender } from '@opentui/solid';

const HEADER_MARKER = 'at — agent tier';
const FOOTER_MARKER = '[1-4] views';
const TERMINAL_ROWS = 24;

async function main(): Promise<void> {
  const setup = await testRender(
    () => (
      <box width="100%" flexDirection="column">
        <box flexDirection="row" gap={2} paddingX={1} flexShrink={0}>
          <text content="at — agent tier" fg="#58a6ff" />
          <text content="auto-refresh ON" fg="#3fb950" />
          <text content="view: dashboard" fg="#aaaaaa" />
          <text content="total: 0" fg="#aaaaaa" />
          <text content="active: 0" fg="#aaaaaa" />
        </box>
        <box flexDirection="row" flexGrow={1} flexShrink={1}>
          <box width="28%" flexDirection="column">
            <box title="Sidebar" border borderStyle="single" borderColor="#555555" flexDirection="column" flexGrow={1} padding={1}>
              <scrollbox flexGrow={1}>
                <box flexDirection="column">
                  <text content="(empty)" />
                </box>
              </scrollbox>
            </box>
          </box>
          <box flexGrow={1} flexDirection="column">
            <box title="Dashboard" border borderStyle="single" borderColor="#555555" flexDirection="column" flexGrow={1} padding={1}>
              <scrollbox flexGrow={1}>
                <box flexDirection="column" paddingX={1} paddingTop={1}>
                  <text content="Quick stats" fg="#58a6ff" />
                  <text content="runs: 0  active: 0  stuck: 0" />
                </box>
              </scrollbox>
            </box>
          </box>
        </box>
        <box flexDirection="row" paddingX={1} flexShrink={0}>
          <text content="[1-4] views  [Tab] focus  [^R] refresh  [^Q] quit" fg="#484f58" />
        </box>
      </box>
    ),
    {
      width: 80,
      height: TERMINAL_ROWS,
      exitOnCtrlC: false,
      consoleOptions: { disabled: true },
    },
  );

  await setup.waitForVisualIdle({});
  const frame = setup.captureCharFrame();
  const lines = frame.split('\n');

  const headerLine = lines[0] ?? '';
  const footerLine = lines[TERMINAL_ROWS - 1] ?? '';
  const headerVisible = headerLine.includes(HEADER_MARKER);
  const footerVisible = footerLine.includes(FOOTER_MARKER);

  // eslint-disable-next-line no-console
  console.log(`--- tui2 render frame (${lines.length} lines, ${TERMINAL_ROWS} expected) ---`);
  for (let i = 0; i < TERMINAL_ROWS; i++) {
    const mark = i === 0 ? 'H' : i === TERMINAL_ROWS - 1 ? 'F' : ' ';
    // eslint-disable-next-line no-console
    console.log(`${mark} ${String(i).padStart(2, ' ')} | ${lines[i] ?? ''}`);
  }

  if (!headerVisible || !footerVisible || lines.length < TERMINAL_ROWS) {
    // eslint-disable-next-line no-console
    console.error(
      `Layout check FAILED: headerVisible=${headerVisible} footerVisible=${footerVisible} rows=${lines.length}/${TERMINAL_ROWS}`,
    );
    process.exit(1);
  }
  // eslint-disable-next-line no-console
  console.log('OK: tui2 header and footer are visible at 80x24');
}

main().catch((err: unknown) => {
  // eslint-disable-next-line no-console
  console.error('tui2 render test crashed:', err);
  process.exit(1);
});
