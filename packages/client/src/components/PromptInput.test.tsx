import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AvailableCommand } from "@matrix/protocol";
import { PromptInput } from "@/components/PromptInput";

const defaultProps = {
  onSend: vi.fn(),
  selectedAgentId: "assistant",
  selectedProfileId: null,
  agents: [
    { id: "assistant", name: "Assistant", command: "assistant", available: true, source: "builtin" as const, profiles: [] },
  ],
};

function makeFetchFiles(files: string[]) {
  return vi.fn((query: string) => {
    if (!query) return Promise.resolve(files.slice(0, 50));
    return Promise.resolve(files.filter((f) => f.toLowerCase().includes(query)));
  });
}

describe("PromptInput", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("renders the textarea with default placeholder", () => {
    render(<PromptInput {...defaultProps} />);
    expect(screen.getByTestId("chat-input")).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/Ask to make changes/)).toBeInTheDocument();
  });

  it("renders custom placeholder", () => {
    render(<PromptInput {...defaultProps} placeholder="Type here" />);
    expect(screen.getByPlaceholderText("Type here")).toBeInTheDocument();
  });

  it("sends message on Enter and clears input", () => {
    const onSend = vi.fn();
    render(<PromptInput {...defaultProps} onSend={onSend} />);

    const input = screen.getByTestId("chat-input");
    fireEvent.change(input, { target: { value: "hello", selectionStart: 5 } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(onSend).toHaveBeenCalledWith("hello");
    expect((input as HTMLTextAreaElement).value).toBe("");
  });

  it("does not send on Shift+Enter", () => {
    const onSend = vi.fn();
    render(<PromptInput {...defaultProps} onSend={onSend} />);

    const input = screen.getByTestId("chat-input");
    fireEvent.change(input, { target: { value: "hello", selectionStart: 5 } });
    fireEvent.keyDown(input, { key: "Enter", shiftKey: true });

    expect(onSend).not.toHaveBeenCalled();
  });

  it("does not send when input is empty", () => {
    const onSend = vi.fn();
    render(<PromptInput {...defaultProps} onSend={onSend} />);

    const input = screen.getByTestId("chat-input");
    fireEvent.keyDown(input, { key: "Enter" });

    expect(onSend).not.toHaveBeenCalled();
  });

  it("disables textarea when disabled prop is true", () => {
    render(<PromptInput {...defaultProps} disabled />);
    expect(screen.getByTestId("chat-input")).toBeDisabled();
  });

  it("shows slash command dropdown when typing /", () => {
    const commands: AvailableCommand[] = [
      { name: "compact", description: "Compact mode" },
      { name: "review", description: "Review code" },
    ];
    render(<PromptInput {...defaultProps} availableCommands={commands} />);

    const input = screen.getByTestId("chat-input");
    fireEvent.change(input, { target: { value: "/", selectionStart: 1 } });

    expect(screen.getByTestId("slash-command-dropdown")).toBeInTheDocument();
    expect(screen.getByTestId("slash-command-item-compact")).toBeInTheDocument();
    expect(screen.getByTestId("slash-command-item-review")).toBeInTheDocument();
  });

  it("filters slash commands by query", () => {
    const commands: AvailableCommand[] = [
      { name: "compact", description: "Compact mode" },
      { name: "review", description: "Review code" },
    ];
    render(<PromptInput {...defaultProps} availableCommands={commands} />);

    const input = screen.getByTestId("chat-input");
    fireEvent.change(input, { target: { value: "/rev", selectionStart: 4 } });

    expect(screen.getByTestId("slash-command-item-review")).toBeInTheDocument();
    expect(screen.queryByTestId("slash-command-item-compact")).not.toBeInTheDocument();
  });

  it("selects slash command on Enter and fills input without sending", () => {
    const onSend = vi.fn();
    const commands: AvailableCommand[] = [
      { name: "compact", description: "Compact mode" },
    ];
    render(<PromptInput {...defaultProps} onSend={onSend} availableCommands={commands} />);

    const input = screen.getByTestId("chat-input");
    fireEvent.change(input, { target: { value: "/", selectionStart: 1 } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(onSend).not.toHaveBeenCalled();
    // The slash command should be filled in the input
    expect((input as HTMLTextAreaElement).value).toContain("/compact");
  });

  it("shows file mention dropdown when typing @", async () => {
    const fetchFiles = makeFetchFiles(["src/main.ts", "src/app.tsx"]);
    render(<PromptInput {...defaultProps} fetchFiles={fetchFiles} />);

    const input = screen.getByTestId("chat-input");
    fireEvent.change(input, { target: { value: "@", selectionStart: 1 } });

    await waitFor(() => {
      expect(screen.getByTestId("file-mention-dropdown")).toBeInTheDocument();
    });
  });

  it("filters file mentions by query", async () => {
    const fetchFiles = makeFetchFiles(["src/main.ts", "src/app.tsx"]);
    render(<PromptInput {...defaultProps} fetchFiles={fetchFiles} />);

    const input = screen.getByTestId("chat-input");
    fireEvent.change(input, { target: { value: "@main", selectionStart: 5 } });

    await waitFor(() => {
      expect(screen.getByTestId("file-mention-item-main.ts")).toBeInTheDocument();
      expect(screen.queryByTestId("file-mention-item-app.tsx")).not.toBeInTheDocument();
    });
  });

  it("inserts file marker on Enter when file dropdown is open", async () => {
    const onSend = vi.fn();
    const fetchFiles = makeFetchFiles(["src/main.ts"]);
    render(<PromptInput {...defaultProps} onSend={onSend} fetchFiles={fetchFiles} />);

    const input = screen.getByTestId("chat-input");
    fireEvent.change(input, { target: { value: "@", selectionStart: 1 } });

    await waitFor(() => {
      expect(screen.getByTestId("file-mention-dropdown")).toBeInTheDocument();
    });

    fireEvent.keyDown(input, { key: "Enter" });

    expect(onSend).not.toHaveBeenCalled();
    expect((input as HTMLTextAreaElement).value).toContain("@[src/main.ts]");
  });

  it("does not show file dropdown when no fetchFiles prop", () => {
    render(<PromptInput {...defaultProps} />);

    const input = screen.getByTestId("chat-input");
    fireEvent.change(input, { target: { value: "@", selectionStart: 1 } });

    expect(screen.queryByTestId("file-mention-dropdown")).not.toBeInTheDocument();
  });
});
