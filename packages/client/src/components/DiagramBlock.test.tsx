import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, within, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DiagramBlock } from "@/components/DiagramBlock";

// Mock the diagram render helpers
vi.mock("@/lib/diagram", () => ({
  renderMermaid: vi.fn().mockResolvedValue('<svg data-testid="mock-svg">mermaid</svg>'),
  renderGraphviz: vi.fn().mockResolvedValue('<svg data-testid="mock-svg">graphviz</svg>'),
  isDiagramLanguage: vi.fn((lang: string) => ["mermaid", "dot", "graphviz"].includes(lang)),
  resetMermaidTheme: vi.fn(),
}));

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
});

describe("DiagramBlock", () => {
  it("renders mermaid diagram as SVG after debounce", async () => {
    const { container } = render(<DiagramBlock language="mermaid" source="graph TD\n  A --> B" />);
    const view = within(container);

    // Advance past debounce timer
    await act(async () => {
      vi.advanceTimersByTime(400);
    });

    const svg = await view.findByTestId("diagram-container");
    expect(svg.innerHTML).toContain("mock-svg");
  });

  it("renders graphviz diagram as SVG after debounce", async () => {
    const { container } = render(<DiagramBlock language="dot" source="digraph { A -> B }" />);
    const view = within(container);

    await act(async () => {
      vi.advanceTimersByTime(400);
    });

    const svg = await view.findByTestId("diagram-container");
    expect(svg.innerHTML).toContain("mock-svg");
  });

  it("toggles between diagram and source view", async () => {
    vi.useRealTimers();
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

  it("shows error and source fallback on render failure with no prior SVG", async () => {
    const { renderMermaid } = await import("@/lib/diagram");
    vi.mocked(renderMermaid).mockRejectedValueOnce(new Error("Parse error"));

    const { container } = render(<DiagramBlock language="mermaid" source="invalid{{{" />);
    const view = within(container);

    // Advance past debounce
    await act(async () => {
      vi.advanceTimersByTime(400);
    });

    // Error should be visible since there's no SVG to show
    expect(view.getByTestId("diagram-error")).toBeInTheDocument();
    expect(view.getByTestId("diagram-error")).toHaveTextContent("Parse error");
    // Source code should be shown as fallback
    expect(view.getByTestId("diagram-source")).toBeInTheDocument();
    // Toggle should not be disabled — user can still switch modes
    expect(view.getByTestId("diagram-toggle")).not.toBeDisabled();
  });

  it("shows zoom controls when diagram is rendered", async () => {
    const { container } = render(<DiagramBlock language="mermaid" source="graph TD\n  A --> B" />);
    const view = within(container);

    await act(async () => {
      vi.advanceTimersByTime(400);
    });

    await view.findByTestId("diagram-container");

    expect(view.getByTestId("diagram-zoom-in")).toBeInTheDocument();
    expect(view.getByTestId("diagram-zoom-out")).toBeInTheDocument();
  });
});
