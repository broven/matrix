import { describe, expect, it } from "vitest";
import { renderMermaid, renderGraphviz, isDiagramLanguage } from "@/lib/diagram";

describe("isDiagramLanguage", () => {
  it("returns true for mermaid", () => {
    expect(isDiagramLanguage("mermaid")).toBe(true);
  });

  it("returns true for dot", () => {
    expect(isDiagramLanguage("dot")).toBe(true);
  });

  it("returns true for graphviz", () => {
    expect(isDiagramLanguage("graphviz")).toBe(true);
  });

  it("returns false for other languages", () => {
    expect(isDiagramLanguage("javascript")).toBe(false);
    expect(isDiagramLanguage("")).toBe(false);
    expect(isDiagramLanguage(undefined)).toBe(false);
  });
});

describe("renderMermaid", () => {
  // Mermaid requires full SVG DOM (getBBox, etc.) not available in jsdom.
  // The render path is verified in-browser; here we only test error handling.
  it.skip("renders a simple flowchart to SVG (requires browser DOM)", async () => {
    const svg = await renderMermaid("test-1", "graph TD\n  A --> B");
    expect(svg).toContain("<svg");
    expect(svg).toContain("</svg>");
  });

  it("throws on invalid syntax", async () => {
    await expect(renderMermaid("test-2", "invalid{{{")).rejects.toThrow();
  });
});

describe("renderGraphviz", () => {
  it("renders a simple digraph to SVG", async () => {
    const svg = await renderGraphviz("digraph { A -> B }");
    expect(svg).toContain("<svg");
    expect(svg).toContain("</svg>");
  });

  it("throws on invalid syntax", async () => {
    await expect(renderGraphviz("not valid dot")).rejects.toThrow();
  });
});
