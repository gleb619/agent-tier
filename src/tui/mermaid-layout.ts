export type MermaidShape = "rect" | "round" | "diamond";

export interface MermaidNode {
  id: string;
  label: string;
  shape: MermaidShape;
  classes: string[];
  order: number;
  subgraph?: string;
}

export interface MermaidEdge {
  from: string;
  to: string;
  label?: string;
}

export interface MermaidSubgraph {
  id: string;
  label: string;
  nodeIds: string[];
}

export interface MermaidGraph {
  direction: "TD" | "LR";
  nodes: MermaidNode[];
  edges: MermaidEdge[];
  subgraphs: MermaidSubgraph[];
}

export interface MermaidGrid {
  rows: string[];
  width: number;
  height: number;
}

interface ParsedNodeToken {
  id: string;
  label: string;
  shape: MermaidShape;
  classes: string[];
}

interface LayoutNode extends MermaidNode {
  rank: number;
  x: number;
  y: number;
  width: number;
  height: number;
  midX: number;
  midY: number;
  box: NodeBox;
}

interface NodeBox {
  top: string;
  middle: string;
  bottom: string;
  width: number;
  height: number;
}

interface Point {
  x: number;
  y: number;
}

const EMPTY = " ";

function keyOf(p: Point): string {
  return `${p.x},${p.y}`;
}

function quotedBody(s: string): string | undefined {
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    return s.slice(1, -1);
  }
  return undefined;
}

function parseNodeToken(token: string): ParsedNodeToken | null {
  token = token.trim();
  if (!token) return null;

  const classes: string[] = [];
  const classMatch = token.match(/:::\s*([A-Za-z0-9_]+)\s*$/);
  if (classMatch) {
    classes.push(classMatch[1]);
    token = token.slice(0, classMatch.index).trim();
  }

  const idMatch = token.match(/^([A-Za-z0-9_]+)/);
  if (!idMatch) return null;
  const id = idMatch[1];
  const rest = token.slice(idMatch[0].length).trim();
  let label = id;
  let shape: MermaidShape = "rect";

  if (rest.startsWith("[") && rest.endsWith("]")) {
    const inner = rest.slice(1, -1).trim();
    label = quotedBody(inner) ?? inner ?? id;
    shape = "rect";
  } else if (rest.startsWith("(") && rest.endsWith(")")) {
    let inner = rest.slice(1, -1).trim();
    if (inner.startsWith("(") && inner.endsWith(")")) inner = inner.slice(1, -1).trim();
    label = quotedBody(inner) ?? inner ?? id;
    shape = "round";
  } else if (rest.startsWith("{") && rest.endsWith("}")) {
    const inner = rest.slice(1, -1).trim();
    label = quotedBody(inner) ?? inner ?? id;
    shape = "diamond";
  }

  return { id, label, shape, classes };
}

export function parseMermaid(src: string): { ok: true; graph: MermaidGraph } | { ok: false; error: string } {
  const text = src
    .replace(/```mermaid\s*/gi, "")
    .replace(/```\s*/g, "")
    .trim();
  if (!text) return { ok: false, error: "empty diagram" };

  const lines: string[] = [];
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("%%")) continue;
    lines.push(line);
  }

  const first = lines.shift();
  if (!first) return { ok: false, error: "missing graph declaration" };
  const dirMatch = first.match(/^(graph|flowchart)\s+(TD|LR|BT|RL)$/i);
  if (!dirMatch) return { ok: false, error: `unsupported graph declaration: ${first}` };
  const direction = dirMatch[2].toUpperCase() as "TD" | "LR";

  const nodeMap = new Map<string, MermaidNode>();
  const edges: MermaidEdge[] = [];
  const subgraphs: MermaidSubgraph[] = [];
  let activeSubgraph: MermaidSubgraph | null = null;
  let orderCounter = 0;

  function upsertNode(token: string): MermaidNode | null {
    const parsed = parseNodeToken(token);
    if (!parsed) return null;
    const existing = nodeMap.get(parsed.id);
    if (existing) {
      for (const c of parsed.classes) {
        if (!existing.classes.includes(c)) existing.classes.push(c);
      }
      if (parsed.shape !== "rect" || parsed.label !== parsed.id) {
        existing.shape = parsed.shape;
        existing.label = parsed.label;
      }
      return existing;
    }
    const node: MermaidNode = {
      ...parsed,
      order: orderCounter++,
      subgraph: activeSubgraph?.id,
    };
    nodeMap.set(node.id, node);
    if (activeSubgraph) activeSubgraph.nodeIds.push(node.id);
    return node;
  }

  for (const line of lines) {
    const lower = line.toLowerCase();
    if (lower.startsWith("subgraph")) {
      const m = line.match(/^subgraph\s+([A-Za-z0-9_]+)(?:\s*\[(.*?)\])?\s*$/i);
      if (m) {
        const label = m[2] ? m[2].trim().replace(/^["']|["']$/g, "") : m[1];
        activeSubgraph = { id: m[1], label, nodeIds: [] };
        subgraphs.push(activeSubgraph);
      }
      continue;
    }
    if (lower === "end") {
      activeSubgraph = null;
      continue;
    }
    if (lower.startsWith("direction")) continue;
    if (lower.startsWith("class") || lower.startsWith("style") || lower.startsWith("linkstyle")) continue;

    const labeledEdge = line.match(/^(.+?)\s*-->\s*\|([^|]*)\|\s*(.+)$/);
    if (labeledEdge) {
      const from = upsertNode(labeledEdge[1]);
      const to = upsertNode(labeledEdge[3]);
      if (from && to) edges.push({ from: from.id, to: to.id, label: labeledEdge[2].trim() });
      continue;
    }

    if (line.includes("-->") && !line.includes("|")) {
      const parts = line
        .split(/\s*-->\s*/)
        .map((p) => p.trim())
        .filter(Boolean);
      for (let i = 0; i < parts.length - 1; i++) {
        const from = upsertNode(parts[i]);
        const to = upsertNode(parts[i + 1]);
        if (from && to) edges.push({ from: from.id, to: to.id });
      }
      if (parts.length > 1) continue;
    }

    upsertNode(line);
  }

  const allNodes = Array.from(nodeMap.values());
  if (allNodes.length === 0) return { ok: false, error: "no nodes found" };

  const usedInSubgraph = new Set<string>();
  for (const sg of subgraphs) for (const id of sg.nodeIds) usedInSubgraph.add(id);
  const rootIds = allNodes.filter((n) => !usedInSubgraph.has(n.id)).map((n) => n.id);
  if (rootIds.length > 0) {
    subgraphs.unshift({ id: "__root__", label: "", nodeIds: rootIds });
  }

  return { ok: true, graph: { direction, nodes: allNodes, edges, subgraphs } };
}

function breakCycles(nodes: MermaidNode[], edges: MermaidEdge[]): { dag: MermaidEdge[]; back: MermaidEdge[] } {
  const adj: Record<string, string[]> = {};
  for (const e of edges) {
    if (!adj[e.from]) adj[e.from] = [];
    adj[e.from].push(e.to);
  }
  const visited = new Set<string>();
  const stack = new Set<string>();
  const backKeys = new Set<string>();

  function dfs(id: string) {
    visited.add(id);
    stack.add(id);
    for (const to of adj[id] ?? []) {
      if (stack.has(to)) {
        backKeys.add(`${id}->${to}`);
      } else if (!visited.has(to)) {
        dfs(to);
      }
    }
    stack.delete(id);
  }

  for (const n of nodes) if (!visited.has(n.id)) dfs(n.id);

  const dag: MermaidEdge[] = [];
  const back: MermaidEdge[] = [];
  for (const e of edges) {
    (backKeys.has(`${e.from}->${e.to}`) ? back : dag).push(e);
  }
  return { dag, back };
}

function computeRanks(nodes: MermaidNode[], dagEdges: MermaidEdge[]): Map<string, number> {
  const rank = new Map<string, number>();
  for (const n of nodes) rank.set(n.id, 0);
  let changed = true;
  while (changed) {
    changed = false;
    for (const e of dagEdges) {
      const rFrom = rank.get(e.from) ?? 0;
      const rTo = rank.get(e.to) ?? 0;
      if (rTo < rFrom + 1) {
        rank.set(e.to, rFrom + 1);
        changed = true;
      }
    }
  }
  return rank;
}

function padCenter(str: string, width: number): string {
  if (str.length >= width) return str.slice(0, width);
  const left = Math.floor((width - str.length) / 2);
  const right = width - str.length - left;
  return " ".repeat(left) + str + " ".repeat(right);
}

function buildBox(node: MermaidNode): NodeBox {
  const isCurrent = node.classes.includes("current");
  if (node.shape === "diamond") {
    const middle = `◆ ${node.label} ◆`;
    return { top: "", middle, bottom: "", width: middle.length, height: 1 };
  }

  const width = Math.max(node.label.length + 2, 3);
  if (isCurrent) {
    const h = "═".repeat(width - 2);
    return {
      top: `╔${h}╗`,
      middle: `║${padCenter(node.label, width - 2)}║`,
      bottom: `╚${h}╝`,
      width,
      height: 3,
    };
  }

  if (node.shape === "round") {
    const h = "─".repeat(width - 2);
    return {
      top: `╭${h}╮`,
      middle: `│${padCenter(node.label, width - 2)}│`,
      bottom: `╰${h}╯`,
      width,
      height: 3,
    };
  }

  const h = "─".repeat(width - 2);
  return {
    top: `┌${h}┐`,
    middle: `│${padCenter(node.label, width - 2)}│`,
    bottom: `└${h}┘`,
    width,
    height: 3,
  };
}

function createGrid(width: number, height: number): string[][] {
  return Array.from({ length: height }, () => Array.from({ length: width }, () => EMPTY));
}

function setCell(grid: string[][], x: number, y: number, ch: string): void {
  if (y < 0 || y >= grid.length || x < 0 || x >= grid[0]!.length) return;
  grid[y]![x] = ch;
}

function drawNode(grid: string[][], n: LayoutNode): void {
  if (n.box.height === 1) {
    for (let i = 0; i < n.box.middle.length; i++) {
      setCell(grid, n.x + i, n.y, n.box.middle[i] ?? EMPTY);
    }
    return;
  }
  for (let i = 0; i < n.box.width; i++) {
    setCell(grid, n.x + i, n.y, n.box.top[i] ?? EMPTY);
    setCell(grid, n.x + i, n.y + 1, n.box.middle[i] ?? EMPTY);
    setCell(grid, n.x + i, n.y + 2, n.box.bottom[i] ?? EMPTY);
  }
}

function sourceJunction(isCurrent: boolean, side: string): string {
  if (isCurrent) {
    if (side === "right") return "╡";
    if (side === "bottom") return "╨";
    if (side === "top") return "╥";
    return "╞";
  }
  if (side === "right") return "┤";
  if (side === "bottom") return "┴";
  if (side === "top") return "┬";
  return "├";
}

function targetJunction(isCurrent: boolean, side: string): string {
  if (isCurrent) {
    if (side === "left") return "╞";
    if (side === "top") return "╥";
    if (side === "bottom") return "╨";
    return "╡";
  }
  if (side === "left") return "├";
  if (side === "top") return "┬";
  if (side === "bottom") return "┴";
  return "┤";
}

function cornerChar(inDir: string, outDir: string): string {
  const map: Record<string, Record<string, string>> = {
    left: { up: "┘", down: "┐" },
    right: { up: "└", down: "┌" },
    up: { left: "┐", right: "┌" },
    down: { left: "┘", right: "└" },
  };
  return map[inDir]?.[outDir] ?? "─";
}

function lineChar(inDir: string | null, outDir: string | null): string {
  if (!inDir || !outDir) return "─";
  if (inDir === "out") return "─";
  if (inDir === outDir) {
    if (inDir === "left" || inDir === "right") return "─";
    return "│";
  }
  return cornerChar(inDir, outDir);
}

function arrowChar(dx: number, dy: number): string {
  if (dx > 0) return "▶";
  if (dx < 0) return "◀";
  if (dy > 0) return "▼";
  if (dy < 0) return "▲";
  return "▶";
}

function dirBetween(a: Point, b: Point): string {
  if (b.x > a.x) return "right";
  if (b.x < a.x) return "left";
  if (b.y > a.y) return "down";
  return "up";
}

function findPath(blocked: Set<string>, start: Point, end: Point, direction: "LR" | "TD"): Point[] | null {
  const preferHorizontal = direction === "LR";
  let minX = Math.min(start.x, end.x) - 6;
  let maxX = Math.max(start.x, end.x) + 6;
  let minY = Math.min(start.y, end.y) - 6;
  let maxY = Math.max(start.y, end.y) + 6;

  for (let attempt = 0; attempt < 4; attempt++) {
    const inside = (p: Point) => p.x >= minX && p.x <= maxX && p.y >= minY && p.y <= maxY;
    const open: { p: Point; g: number; dir?: string }[] = [];
    const gScore = new Map<string, number>();
    const came = new Map<string, { from: string; dir: string }>();
    gScore.set(keyOf(start), 0);
    open.push({ p: start, g: 0 });

    let cur = open[0];
    let found = false;
    while (open.length > 0) {
      open.sort(
        (a, b) =>
          a.g +
          Math.abs(a.p.x - end.x) +
          Math.abs(a.p.y - end.y) -
          (b.g + Math.abs(b.p.x - end.x) + Math.abs(b.p.y - end.y)),
      );
      cur = open.shift()!;
      if (cur.p.x === end.x && cur.p.y === end.y) {
        found = true;
        break;
      }

      const base = cur.p;
      const nbs: { p: Point; dir: string }[] = [];
      const add = (dx: number, dy: number, dir: string) => {
        const p = { x: base.x + dx, y: base.y + dy };
        if (!inside(p) || blocked.has(keyOf(p))) return;
        nbs.push({ p, dir });
      };
      if (preferHorizontal) {
        add(1, 0, "right");
        add(-1, 0, "left");
        add(0, 1, "down");
        add(0, -1, "up");
      } else {
        add(0, 1, "down");
        add(0, -1, "up");
        add(1, 0, "right");
        add(-1, 0, "left");
      }

      for (const nb of nbs) {
        const prev = came.get(keyOf(base));
        const turn = prev && prev.dir !== nb.dir ? 5 : 0;
        const ng = cur.g + 1 + turn;
        const k = keyOf(nb.p);
        if (ng < (gScore.get(k) ?? Infinity)) {
          gScore.set(k, ng);
          came.set(k, { from: keyOf(base), dir: nb.dir });
          open.push({ p: nb.p, g: ng });
        }
      }
    }

    if (found) {
      const path: Point[] = [end];
      let k = keyOf(end);
      while (k !== keyOf(start)) {
        const c = came.get(k);
        if (!c) break;
        const [x, y] = c.from.split(",").map(Number);
        path.unshift({ x, y });
        k = c.from;
      }
      return path;
    }

    minX -= 6;
    maxX += 6;
    minY -= 6;
    maxY += 6;
  }

  return null;
}

function layoutNodes(nodes: MermaidNode[], edges: MermaidEdge[], direction: "LR" | "TD"): LayoutNode[] {
  const { dag } = breakCycles(nodes, edges);
  const rankMap = computeRanks(nodes, dag);
  const maxRank = Math.max(0, ...rankMap.values());

  const byRank: MermaidNode[][] = [];
  for (let i = 0; i <= maxRank; i++) byRank.push([]);
  for (const n of nodes) {
    const r = rankMap.get(n.id) ?? 0;
    byRank[r]!.push(n);
  }
  for (const arr of byRank) {
    arr.sort((a, b) => a.order - b.order);
  }

  const gapWidths: number[] = Array(maxRank).fill(2);
  for (let r = 0; r < maxRank; r++) {
    for (const e of edges) {
      const sR = rankMap.get(e.from) ?? 0;
      const tR = rankMap.get(e.to) ?? 0;
      if (sR <= r && r < tR && e.label) {
        gapWidths[r] = Math.max(gapWidths[r], e.label.length + 2);
      }
    }
  }

  const layout: LayoutNode[] = [];
  if (direction === "LR") {
    let x = 2;
    const rankStartX: number[] = [];
    for (let r = 0; r <= maxRank; r++) {
      rankStartX.push(x);
      const maxWidth = Math.max(1, ...byRank[r]!.map((n) => buildBox(n).width));
      let y = 2;
      for (const n of byRank[r]!) {
        const box = buildBox(n);
        const ln: LayoutNode = {
          ...n,
          rank: r,
          x,
          y,
          width: box.width,
          height: box.height,
          midX: x + Math.floor(box.width / 2),
          midY: y + Math.floor(box.height / 2),
          box,
        };
        layout.push(ln);
        y += box.height + 1;
      }
      x += maxWidth + (r < maxRank ? gapWidths[r] : 0);
    }
  } else {
    let y = 2;
    const rankStartY: number[] = [];
    for (let r = 0; r <= maxRank; r++) {
      rankStartY.push(y);
      const maxHeight = Math.max(1, ...byRank[r]!.map((n) => buildBox(n).height));
      let x = 2;
      for (const n of byRank[r]!) {
        const box = buildBox(n);
        const ln: LayoutNode = {
          ...n,
          rank: r,
          x,
          y,
          width: box.width,
          height: box.height,
          midX: x + Math.floor(box.width / 2),
          midY: y + Math.floor(box.height / 2),
          box,
        };
        layout.push(ln);
        x += box.width + 1;
      }
      y += maxHeight + (r < maxRank ? gapWidths[r] : 0);
    }
  }

  return layout;
}

function drawEdge(
  path: Point[],
  source: LayoutNode,
  target: LayoutNode,
  grid: string[][],
  direction: "LR" | "TD",
): void {
  const _outDir = path.length > 1 ? dirBetween(path[0], path[1]) : direction === "LR" ? "right" : "down";
  setCell(
    grid,
    source.x + source.width - 1,
    source.midY,
    sourceJunction(source.classes.includes("current"), direction === "LR" ? "right" : "bottom"),
  );

  const lastIdx = path.length - 1;
  for (let i = 0; i <= lastIdx; i++) {
    const p = path[i];
    let ch: string;
    if (i === lastIdx) {
      const dx = target.x - p.x;
      const dy = target.y - p.y;
      ch = arrowChar(dx, dy);
    } else {
      const inDir = i === 0 ? (direction === "LR" ? "left" : "up") : dirBetween(path[i - 1], p);
      const outDirNext = dirBetween(p, path[i + 1]);
      ch = lineChar(inDir, outDirNext);
    }
    setCell(grid, p.x, p.y, ch);
  }

  setCell(
    grid,
    target.x,
    target.midY,
    targetJunction(target.classes.includes("current"), direction === "LR" ? "left" : "top"),
  );
}

function placeLabel(path: Point[], label: string, grid: string[][]): void {
  if (!label || label.length === 0) return;
  let bestStart: { x: number; y: number; len: number } | null = null;
  for (let i = 0; i < path.length; ) {
    let j = i;
    while (j + 1 < path.length && path[j + 1].y === path[i].y && path[j + 1].x === path[j].x + 1) {
      j++;
    }
    const len = j - i + 1;
    if (len >= label.length && (bestStart === null || len > bestStart.len)) {
      bestStart = { x: path[i].x, y: path[i].y, len };
    }
    i = j + 1;
  }
  if (!bestStart) return;
  const startX = bestStart.x + Math.floor((bestStart.len - label.length) / 2);
  for (let i = 0; i < label.length; i++) {
    setCell(grid, startX + i, bestStart.y, label[i] ?? EMPTY);
  }
}

function renderSubgraph(graph: MermaidGraph, sg: MermaidSubgraph, direction: "LR" | "TD"): string[][] {
  const nodeSet = new Set(sg.nodeIds);
  const nodes = graph.nodes.filter((n) => nodeSet.has(n.id));
  const edges = graph.edges.filter((e) => nodeSet.has(e.from) && nodeSet.has(e.to));
  if (nodes.length === 0) return [];

  const layout = layoutNodes(nodes, edges, direction);
  const layoutMap = new Map(layout.map((n) => [n.id, n]));

  const width = Math.max(20, ...layout.map((n) => n.x + n.width + 4));
  const height = Math.max(10, ...layout.map((n) => n.y + n.height + 4));

  const grid = createGrid(width, height);
  const blocked = new Set<string>();
  for (const n of layout) {
    for (let y = n.y; y < n.y + n.height; y++) {
      for (let x = n.x; x < n.x + n.width; x++) {
        blocked.add(`${x},${y}`);
      }
    }
    drawNode(grid, n);
  }

  for (const e of edges) {
    const source = layoutMap.get(e.from);
    const target = layoutMap.get(e.to);
    if (!source || !target) continue;
    const start: Point =
      direction === "LR"
        ? { x: source.x + source.width, y: source.midY }
        : { x: source.midX, y: source.y + source.height };
    const end: Point = direction === "LR" ? { x: target.x - 1, y: target.midY } : { x: target.midX, y: target.y - 1 };
    const path = findPath(blocked, start, end, direction);
    if (!path) continue;
    for (let i = 1; i < path.length - 1; i++) {
      blocked.add(keyOf(path[i]));
    }
    drawEdge(path, source, target, grid, direction);
    placeLabel(path, e.label ?? "", grid);
  }

  return grid;
}

function cropGrid(grid: string[][]): string[][] {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (let y = 0; y < grid.length; y++) {
    for (let x = 0; x < grid[0]!.length; x++) {
      if (grid[y]![x] !== EMPTY) {
        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x);
        minY = Math.min(minY, y);
        maxY = Math.max(maxY, y);
      }
    }
  }
  if (!Number.isFinite(minX)) return [[]];
  minX = Math.max(0, minX - 1);
  minY = Math.max(0, minY - 1);
  maxX = Math.min(grid[0]!.length - 1, maxX + 1);
  maxY = Math.min(grid.length - 1, maxY + 1);
  const out: string[][] = [];
  for (let y = minY; y <= maxY; y++) {
    const row: string[] = [];
    for (let x = minX; x <= maxX; x++) {
      row.push(grid[y]![x] ?? EMPTY);
    }
    out.push(row);
  }
  return out;
}

function boxAround(rows: string[][], label: string): string[][] {
  const width = Math.max(4, ...rows.map((r) => r.length), label.length + 4);
  const _height = rows.length + 2;
  const out: string[][] = [];
  const topLabel = label
    ? `┌ ${label} ${"─".repeat(Math.max(0, width - label.length - 4))}┐`
    : `┌${"─".repeat(width - 2)}┐`;
  const bottom = `└${"─".repeat(width - 2)}┘`;
  out.push(topLabel.split(""));
  for (const row of rows) {
    const padded = [...row];
    while (padded.length < width - 2) padded.push(EMPTY);
    out.push(["│", ...padded, "│"]);
  }
  out.push(bottom.split(""));
  return out;
}

function _rowsToStrings(rows: string[][]): string[] {
  return rows.map((r) => r.join(""));
}

export function layoutMermaid(graph: MermaidGraph): MermaidGrid {
  const direction = graph.direction;
  const subgraphs = graph.subgraphs.filter((sg) => sg.id !== "__root__" || sg.nodeIds.length > 0);
  const sections: string[][][] = [];

  for (const sg of subgraphs) {
    const raw = renderSubgraph(graph, sg, direction);
    if (raw.length === 0) continue;
    const cropped = cropGrid(raw);
    if (sg.id === "__root__" && !sg.label) {
      sections.push(cropped);
    } else {
      sections.push(boxAround(cropped, sg.label));
    }
  }

  if (sections.length === 0) {
    return { rows: [], width: 0, height: 0 };
  }

  const masterWidth = Math.max(...sections.map((s) => s[0]?.length ?? 0));
  const rows: string[] = [];
  for (const section of sections) {
    if (rows.length > 0) rows.push("");
    for (const row of section) {
      const str = row.join("").padEnd(masterWidth, EMPTY);
      rows.push(str);
    }
  }
  return {
    rows,
    width: masterWidth,
    height: rows.length,
  };
}

export function renderMermaid(
  src: string,
): { ok: true; grid: MermaidGrid } | { ok: false; source: string; error: string } {
  const parsed = parseMermaid(src);
  if (!parsed.ok) return { ok: false, source: src, error: parsed.error };
  try {
    const grid = layoutMermaid(parsed.graph);
    return { ok: true, grid };
  } catch (err) {
    return { ok: false, source: src, error: err instanceof Error ? err.message : String(err) };
  }
}
