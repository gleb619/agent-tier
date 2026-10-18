import type { Root, Table, TableCell } from "mdast";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import remarkStringify from "remark-stringify";
import { unified } from "unified";
import type { Node } from "unist";
import { visit } from "unist-util-visit";

/**
 * remark-stringify escapes `_`, `*` and `~` in text (`AT\_NO\_DAEMON`, `\~/.at`), which litters every
 * hand-written board on its first mutation. Keep an escape only where dropping it would change the parse:
 * `_` next to a non-word char, `*`/`~` when the cell holds a pair that could open emphasis/strike.
 */
export function relaxEscapes(escaped: string, raw: string): string {
  const count = (ch: string) => raw.split(ch).length - 1;
  return escaped
    .replace(/\\_(?<=[A-Za-z0-9]\\_)(?=[A-Za-z0-9])/g, "_")
    .replace(/\\([*~])/g, (m, ch: string) => (count(ch) < 2 ? ch : m));
}

export function createProcessor() {
  return unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkStringify, {
      handlers: {
        text: (node: { value: string }, _parent: unknown, state: any, info: any) =>
          relaxEscapes(state.safe(node.value, info), node.value),
      },
    });
}

export type Processor = ReturnType<typeof createProcessor>;

export function cellText(cell: Node): string {
  const out: string[] = [];
  const walk = (nodes: Node[] | undefined): void => {
    for (const n of nodes ?? []) {
      const node = n as { type: string; value?: string; children?: Node[] };
      if (node.type === "text" || node.type === "inlineCode") out.push(node.value ?? "");
      else if (node.children) walk(node.children);
    }
  };
  walk((cell as { children?: Node[] }).children);
  return out.join("").trim();
}

/**
 * Cells hold the raw value: remark-stringify escapes `|` as `\|` on write and
 * remark-parse unescapes it on read, so the round-trip is lossless and idempotent.
 * Escaping by hand here would store a literal backslash in the value.
 */
export function makeCell(text: string): TableCell {
  return { type: "tableCell", children: [{ type: "text", value: String(text) }] };
}

export function setCellText(cell: TableCell, text: string): void {
  cell.children = [{ type: "text", value: String(text) }];
}

export interface ParsedBoard {
  processor: Processor;
  tree: Root;
  table: Table;
  headers: string[];
}

/**
 * The board table is the one whose header row contains both `ID` and `Status`.
 * Discovery by header content (never by position) is what lets the Status Legend
 * table coexist in the same file and lets columns be reordered or extended.
 */
export function parseBoardText(content: string): ParsedBoard {
  const processor = createProcessor();
  const tree = processor.parse(content) as Root;
  const found: { table: Table | null; headers: string[] } = { table: null, headers: [] };

  visit(tree, "table", (node: Table) => {
    if (!node.children || node.children.length === 0) return;
    const headerCells = node.children[0].children.map((c) => cellText(c));
    if (headerCells.includes("ID") && headerCells.includes("Status")) {
      found.table = node;
      found.headers = headerCells;
    }
  });

  if (!found.table) {
    throw new Error("No kanban task table found (expected ID + Status columns)");
  }
  return { processor, tree, table: found.table, headers: found.headers };
}

export function stringifyBoard(processor: Processor, tree: Root): string {
  return String(processor.stringify(tree));
}
