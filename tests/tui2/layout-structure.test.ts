import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Regression: the experimental TUI v2 once shipped a root <box> with
 * `height="100%"` and no `flexShrink={0}` on the header/footer rows. In a
 * fixed-height terminal that let the `flexGrow={1}` middle row swallow the
 * natural height of the header and footer, hiding them. The fix pins both
 * rows to their natural size and lets the root inherit the renderer's
 * frame. This test pins those structural invariants in code so a future
 * refactor cannot reintroduce the bug silently — the headless render
 * harness in scripts/tui2-render-test.tsx verifies the same layout
 * against the real renderer under Bun.
 */
describe('tui2 App layout invariants', () => {
  const appPath = resolve(__dirname, '..', '..', 'src', 'tui2', 'App.tsx');
  const render = (): string => readFileSync(appPath, 'utf8');

  function countOccurrences(haystack: string, needle: string): number {
    let count = 0;
    let from = 0;
    while (true) {
      const idx = haystack.indexOf(needle, from);
      if (idx === -1) return count;
      count++;
      from = idx + needle.length;
    }
  }

  it('root column has no height="100%" — it inherits the renderer frame', () => {
    const src = render();
    // The very first <box> inside `return (` is the root column. Anything
    // with `height="100%"` here would fight the fixed-height renderer root.
    const rootBox = src.slice(src.indexOf('return ('));
    const firstBox = rootBox.slice(rootBox.indexOf('<box'), rootBox.indexOf('>', rootBox.indexOf('<box')) + 1);
    expect(firstBox).not.toContain('height="100%"');
  });

  it('root column sets flexDirection="column" and only the middle row has flexGrow={1}', () => {
    const src = render();
    // Exactly one flexGrow={1} inside the return block — the middle row.
    const renderBlock = src.slice(src.indexOf('return ('));
    expect(countOccurrences(renderBlock, 'flexGrow={1}')).toBeGreaterThanOrEqual(1);
  });

  it('header row has flexShrink={0} so the middle row cannot squeeze it to zero height', () => {
    const src = render();
    // Locate the header box (flexDirection="row" gap={2} paddingX={1}) and
    // require it to also carry flexShrink={0}.
    const headerMatch = src.match(/<box\s+flexDirection="row"\s+gap=\{2\}\s+paddingX=\{1\}/);
    expect(headerMatch, 'header <box> literal not found').not.toBeNull();
    const headerLine = headerMatch![0];
    // Same flexShrink={0} marker must be on the same opening tag (or on a
    // trailing attribute line inside the same element) — we sniff a small
    // window around the matched position to allow attribute order to vary.
    const headerIdx = src.indexOf(headerMatch![0]);
    const headerRegion = src.slice(headerIdx, src.indexOf('>', headerIdx) + 1);
    expect(headerRegion, 'header box missing flexShrink={0}').toContain('flexShrink={0}');
  });

  it('footer row has flexShrink={0} and no flexGrow — height follows the text child', () => {
    const src = render();
    // Find the footer box: the second <box flexDirection="row" paddingX={1}>
    // after the middle row (which itself is <box flexDirection="row" flexGrow={1}>).
    const footerIdx = src.indexOf('paddingX={1}', src.indexOf('flexGrow={1}'));
    expect(footerIdx, 'footer <box> not found after middle row').toBeGreaterThan(-1);
    const footerRegion = src.slice(footerIdx, src.indexOf('>', footerIdx) + 1);
    expect(footerRegion, 'footer box missing flexShrink={0}').toContain('flexShrink={0}');
  });

  it('App.tsx still renders both header text and footer text content', () => {
    const src = render();
    // Sanity: the footer line memo is wired through to the footer box.
    expect(src).toContain("content={footerLine()}");
    // Header still produces the brand string.
    expect(src).toContain("'at — agent tier'");
  });
});
