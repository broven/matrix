import type { ReactNode } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionInfo } from "@matrix/protocol";
import type { PromptCallbacks } from "@matrix/sdk";
import { SessionView } from "@/components/chat/SessionView";

const attachSession = vi.fn();
const mockedClient = {
  attachSession,
};

vi.mock("@/hooks/useMatrixClient", () => ({
  useMatrixClient: () => ({
    client: mockedClient,
  }),
}));

vi.mock("@/components/ui/scroll-area", () => ({
  ScrollArea: ({ children, className }: { children: ReactNode; className?: string }) => (
    <div className={className}>{children}</div>
  ),
}));

const baseSessionInfo: SessionInfo = {
  sessionId: "sess_test",
  agentId: "assistant",
  cwd: "/tmp/workspace",
  createdAt: "2026-03-14T10:00:00.000Z",
  status: "active",
  recoverable: true,
  agentSessionId: "agent_sess_test",
  lastActiveAt: "2026-03-14T10:00:00.000Z",
  suspendedAt: null,
  closeReason: null,
  worktreeId: null,
  repositoryId: null,
  branch: null,
};

function createAttachedSession() {
  let updateCallbacks: PromptCallbacks = {};

  const session = {
    subscribe: vi.fn(),
    subscribeToUpdates: vi.fn((callbacks) => {
      updateCallbacks = callbacks;
      return vi.fn();
    }),
    getHistory: vi.fn(async () => []),
    prompt: vi.fn(),
    approveToolCall: vi.fn(),
    rejectToolCall: vi.fn(),
  };

  return {
    session,
    get callbacks() {
      return updateCallbacks;
    },
  };
}

describe("SessionView", () => {
  beforeEach(() => {
    attachSession.mockReset();
    Element.prototype.scrollIntoView = vi.fn();
  });

  afterEach(() => {
    cleanup();
  });

  it("shows restoring state for suspended sessions and re-enables input after completion", async () => {
    const attached = createAttachedSession();
    attachSession.mockReturnValue(attached.session);

    render(
      <SessionView
        sessionInfo={{ ...baseSessionInfo, status: "suspended", suspendedAt: "2026-03-14T10:30:00.000Z" }}
      />,
    );

    await waitFor(() => {
      expect(attached.session.subscribeToUpdates).toHaveBeenCalled();
    });

    const input = screen.getByPlaceholderText("Send a message to resume this session...");
    fireEvent.change(input, { target: { value: "resume work" } });
    fireEvent.click(screen.getByRole("button", { name: "Send message" }));

    expect(attached.session.prompt).toHaveBeenCalledWith("resume work", expect.any(Object));

    await act(async () => {
      attached.callbacks.onRestoring?.();
    });

    expect(screen.getAllByText(/Restoring/).length).toBeGreaterThan(0);
    expect((screen.getByRole("textbox") as HTMLTextAreaElement).disabled).toBe(true);

    await act(async () => {
      attached.callbacks.onComplete?.({ stopReason: "end_turn" });
    });

    await waitFor(() => {
      expect((screen.getByRole("textbox") as HTMLTextAreaElement).disabled).toBe(false);
    });
    expect(screen.getByPlaceholderText("Ask to make changes, @mention files, run /commands")).toBeTruthy();
  });

  it("marks terminal session errors as closed and disables prompting", async () => {
    const attached = createAttachedSession();
    attachSession.mockReturnValue(attached.session);

    render(<SessionView sessionInfo={baseSessionInfo} />);

    await waitFor(() => {
      expect(attached.session.subscribeToUpdates).toHaveBeenCalled();
    });

    const input = screen.getByPlaceholderText("Ask to make changes, @mention files, run /commands");
    fireEvent.change(input, { target: { value: "hello" } });
    fireEvent.click(screen.getByRole("button", { name: "Send message" }));

    await act(async () => {
      attached.callbacks.onError?.({ code: "session_closed", message: "Session is closed" });
    });

    await waitFor(() => {
      expect((screen.getByRole("textbox") as HTMLTextAreaElement).disabled).toBe(true);
    });
    expect(screen.getAllByText("Session is closed").length).toBeGreaterThan(0);
  });
});
