import type { ReactNode } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionInfo } from "@matrix/protocol";
import type { PromptCallbacks } from "@matrix/sdk";
import { SessionView } from "@/components/chat/SessionView";

const attachSession = vi.fn();
const getServerConfig = vi.fn(async () => ({ reposPath: "", worktreesPath: "" }));
const mockedClient = {
  attachSession,
  getServerConfig,
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
  profileId: null,
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

const testAgents = [
  { id: "assistant", name: "Assistant", command: "assistant", available: true, source: "builtin" as const, profiles: [] },
];

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
    promptWithContent: vi.fn(),
    approveToolCall: vi.fn(),
    rejectToolCall: vi.fn(),
    availableCommands: [],
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
    getServerConfig.mockReset().mockResolvedValue({ reposPath: "", worktreesPath: "" });
    Element.prototype.scrollIntoView = vi.fn();
  });

  afterEach(() => {
    cleanup();
  });

  it("shows active session and allows sending messages", async () => {
    const attached = createAttachedSession();
    attachSession.mockReturnValue(attached.session);

    render(
      <SessionView
        sessionInfo={baseSessionInfo}
        agents={testAgents}
      />,
    );

    await waitFor(() => {
      expect(attached.session.subscribeToUpdates).toHaveBeenCalled();
    });
  });

  it("marks terminal session errors as closed and disables prompting", async () => {
    const attached = createAttachedSession();
    attachSession.mockReturnValue(attached.session);

    render(<SessionView sessionInfo={baseSessionInfo} agents={testAgents} />);

    await waitFor(() => {
      expect(attached.session.subscribeToUpdates).toHaveBeenCalled();
    });

    await act(async () => {
      attached.callbacks.onError?.({ code: "session_closed", message: "Session is closed" });
    });

    await waitFor(() => {
      expect((screen.getByRole("textbox") as HTMLTextAreaElement).disabled).toBe(true);
    });
  });
});
