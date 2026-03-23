import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DiagramBlock } from "@/components/DiagramBlock";

// Mock the diagram render helpers
vi.mock("@/lib/diagram", () => ({
  renderMermaid: vi.fn().mockResolvedValue('<svg data-testid="mock-svg">mermaid</svg>'),
  renderGraphviz: vi.fn().mockResolvedValue('<svg data-testid="mock-svg">graphviz</svg>'),
  isDiagramLanguage: vi.fn((lang: string) => ["mermaid", "dot", "graphviz"].includes(lang)),
  resetMermaidTheme: vi.fn(),
}));

describe("DiagramBlock", () => {
  it("renders mermaid diagram as SVG", async () => {
    const { container } = render(<DiagramBlock language="mermaid" source="graph TD\n  A --> B" />);
    const view = within(container);
    const svg = await view.findByTestId("diagram-container");
    expect(svg.innerHTML).toContain("mock-svg");
  });

  it("renders graphviz diagram as SVG", async () => {
    const { container } = render(<DiagramBlock language="dot" source="digraph { A -> B }" />);
    const view = within(container);
    const svg = await view.findByTestId("diagram-container");
    expect(svg.innerHTML).toContain("mock-svg");
  });

  it("toggles between diagram and source view", async () => {
    const user = userEvent.setup();
    const { container } = render(<DiagramBlock language="mermaid" source="graph TD\n  A --> B" />);
    const view = within(container);

    // Wait for diagram to render
    await view.findByTestId("diagram-container");

    // Click toggle to show source
    const toggleBtn = view.getByTestId("diagram-toggle");
    await user.click(toggleBtn);

    // Source code should be visible
    expect(view.getByTestId("diagram-source")).toBeInTheDocument();

    // Click toggle back to diagram
    await user.click(toggleBtn);
    expect(view.getByTestId("diagram-container")).toBeInTheDocument();
  });

  it("shows error state with source on render failure", async () => {
    const { renderMermaid } = await import("@/lib/diagram");
    vi.mocked(renderMermaid).mockRejectedValueOnce(new Error("Parse error"));

    const { container } = render(<DiagramBlock language="mermaid" source="invalid{{{" />);
    const view = within(container);

    const error = await view.findByTestId("diagram-error");
    expect(error).toBeInTheDocument();
    // Source should be shown on error
    expect(view.getByTestId("diagram-source")).toBeInTheDocument();
  });
});
