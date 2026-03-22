import { cleanup, fireEvent, render, screen, waitFor, act } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AvailableCommand } from "@matrix/protocol";
import { PromptInput } from "@/components/PromptInput";

const defaultProps = {
  onSend: vi.fn(),
  selectedAgentId: "assistant",
  selectedProfileId: null,
  agents: [
    {
      id: "assistant",
      name: "Assistant",
      command: "assistant",
      available: true,
      source: "builtin" as const,
      profiles: [],
    },
  ],
};

describe("PromptInput", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("renders the editor with data-testid chat-input", () => {
    render(<PromptInput {...defaultProps} />);
    expect(screen.getByTestId("chat-input")).toBeInTheDocument();
  });

  it("renders custom placeholder via Tiptap data-placeholder attribute", () => {
    render(<PromptInput {...defaultProps} placeholder="Type here" />);
    const editor = screen.getByTestId("chat-input");
    // Tiptap puts placeholder on the first paragraph
    const para = editor.querySelector("p");
    expect(para?.getAttribute("data-placeholder")).toBe("Type here");
  });

  it("does not send when input is empty", () => {
    const onSend = vi.fn();
    render(<PromptInput {...defaultProps} onSend={onSend} />);

    const editor = screen.getByTestId("chat-input");
    fireEvent.keyDown(editor, { key: "Enter" });

    expect(onSend).not.toHaveBeenCalled();
  });

  it("renders send button with correct testid", () => {
    render(<PromptInput {...defaultProps} />);
    expect(screen.getByTestId("send-btn")).toBeInTheDocument();
  });

  it("renders agent selector button with correct testid", () => {
    render(<PromptInput {...defaultProps} />);
    expect(screen.getByTestId("agent-selector-btn")).toBeInTheDocument();
  });

  it("shows agent menu on agent selector click", async () => {
    render(<PromptInput {...defaultProps} />);
    const agentBtn = screen.getByTestId("agent-selector-btn");

    await act(async () => {
      fireEvent.click(agentBtn);
    });

    expect(screen.getByTestId("agent-option-assistant")).toBeInTheDocument();
  });

  it("shows agent name in selector button", () => {
    render(<PromptInput {...defaultProps} />);
    const agentBtn = screen.getByTestId("agent-selector-btn");
    expect(agentBtn.textContent).toContain("Assistant");
  });

  it("send button is disabled when no content", () => {
    render(<PromptInput {...defaultProps} />);
    const sendBtn = screen.getByTestId("send-btn");
    expect(sendBtn).toBeDisabled();
  });

  it("send button is disabled when no agent selected", () => {
    render(<PromptInput {...defaultProps} selectedAgentId={null} />);
    const sendBtn = screen.getByTestId("send-btn");
    expect(sendBtn).toBeDisabled();
  });
});
