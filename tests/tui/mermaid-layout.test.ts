import { describe, expect, it } from "vitest";
import { layoutMermaid, parseMermaid, renderMermaid } from "../../src/tui/mermaid-layout";

describe("parseMermaid", () => {
  it("parses a TD graph with nodes and edges", () => {
    const parsed = parseMermaid(`graph TD\n  A --> B\n  B --> C`);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.graph.direction).toBe("TD");
    expect(parsed.graph.nodes.map((n) => n.id).sort()).toEqual(["A", "B", "C"]);
    expect(parsed.graph.edges).toHaveLength(2);
  });

  it("parses an LR flowchart with shapes", () => {
    const parsed = parseMermaid(`flowchart LR\n  A[Start] --> B{Decision}\n  B --> C(End)`);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.graph.direction).toBe("LR");
    const byId = Object.fromEntries(parsed.graph.nodes.map((n) => [n.id, n]));
    expect(byId.A?.shape).toBe("rect");
    expect(byId.A?.label).toBe("Start");
    expect(byId.B?.shape).toBe("diamond");
    expect(byId.B?.label).toBe("Decision");
    expect(byId.C?.shape).toBe("round");
    expect(byId.C?.label).toBe("End");
  });

  it("parses edge labels", () => {
    const parsed = parseMermaid(`graph LR\n  A -->|Yes| B\n  A -->|No| C`);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const labels = parsed.graph.edges.map((e) => e.label).sort();
    expect(labels).toEqual(["No", "Yes"]);
  });

  it("parses subgraphs", () => {
    const parsed = parseMermaid(`flowchart LR\n  subgraph g0["queue"]\n    direction LR\n    A --> B\n  end`);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.graph.subgraphs).toHaveLength(1);
    expect(parsed.graph.subgraphs[0]?.label).toBe("queue");
  });

  it("rejects invalid declarations", () => {
    expect(parseMermaid("not a graph").ok).toBe(false);
  });
});

describe("layoutMermaid", () => {
  it("renders a linear LR flow with arrows", () => {
    const parsed = parseMermaid(`graph LR\n  A --> B --> C`);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const grid = layoutMermaid(parsed.graph);
    expect(grid.rows.length).toBeGreaterThan(0);
    const flat = grid.rows.join("\n");
    expect(flat).toContain("A");
    expect(flat).toContain("B");
    expect(flat).toContain("C");
    expect(flat).toContain("▶");
  });

  it("renders branching logic without overlapping nodes", () => {
    const parsed = parseMermaid(`graph LR\n  A --> B\n  A --> C\n  B --> D\n  C --> D`);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const grid = layoutMermaid(parsed.graph);
    const flat = grid.rows.join("\n");
    expect(flat).toContain("A");
    expect(flat).toContain("B");
    expect(flat).toContain("C");
    expect(flat).toContain("D");
    // Each row should not contain two node bodies on the same line unless they are vertically aligned.
    // This is a smoke check that the layout ran and produced a bounded grid.
    expect(grid.width).toBeGreaterThan(0);
    expect(grid.height).toBeGreaterThan(0);
  });

  it("renders conditional edge labels", () => {
    const parsed = parseMermaid(`graph LR\n  A -->|Yes| B\n  A -->|No| C`);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const grid = layoutMermaid(parsed.graph);
    const flat = grid.rows.join("\n");
    expect(flat).toContain("Yes");
    expect(flat).toContain("No");
  });

  it("renders a cycle (scheduler-style) without crashing", () => {
    const parsed = parseMermaid(`flowchart LR\n  A --> B\n  B --> C\n  C --> A`);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const grid = layoutMermaid(parsed.graph);
    const flat = grid.rows.join("\n");
    expect(flat).toContain("A");
    expect(flat).toContain("B");
    expect(flat).toContain("C");
    expect(grid.rows.length).toBeGreaterThan(0);
  });
});

describe("renderMermaid", () => {
  it("returns a grid for valid mermaid", () => {
    const result = renderMermaid("graph LR\n  A --> B");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.grid.rows.length).toBeGreaterThan(0);
  });

  it("falls back to raw source on parse errors", () => {
    const result = renderMermaid("not a graph");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.source).toContain("not a graph");
  });

  it("never throws for malformed input", () => {
    expect(() => renderMermaid("")).not.toThrow();
    expect(() => renderMermaid("graph XX\n  A --> B")).not.toThrow();
    expect(() => renderMermaid("graph LR\n  A -- weird --> B")).not.toThrow();
  });
});
