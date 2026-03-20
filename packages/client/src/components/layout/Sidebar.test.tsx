import type { ReactNode } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SessionInfo, RepositoryInfo, WorktreeInfo } from "@matrix/protocol";
import { Sidebar } from "@/components/layout/Sidebar";

vi.mock("@/components/ui/scroll-area", () => ({
  ScrollArea: ({ children, className }: { children: ReactNode; className?: string }) => (
    <div className={className}>{children}</div>
  ),
}));

const testAgents = [
  { id: "assistant", name: "Assistant", command: "assistant", available: true, source: "builtin" as const, profiles: [] },
];

const makeRepo = (overrides?: Partial<RepositoryInfo>): RepositoryInfo => ({
  id: "repo-1",
  name: "my-project",
  path: "/tmp/my-project",
  remoteUrl: "https://github.com/user/my-project",
  serverId: "server-1",
  defaultBranch: "main",
  ...overrides,
});

const makeWorktree = (overrides?: Partial<WorktreeInfo>): WorktreeInfo => ({
  id: "wt-1",
  repositoryId: "repo-1",
  branch: "feat-login",
  baseBranch: "main",
  path: "/tmp/worktrees/feat-login",
  ...overrides,
});

const makeSession = (overrides?: Partial<SessionInfo>): SessionInfo => ({
  sessionId: "sess-1",
  agentId: "assistant",
  profileId: null,
  cwd: "/tmp/workspace",
  createdAt: "2026-03-20T10:00:00.000Z",
  status: "active",
  recoverable: true,
  agentSessionId: "agent_sess_1",
  lastActiveAt: "2026-03-20T10:00:00.000Z",
  suspendedAt: null,
  closeReason: null,
  worktreeId: "wt-1",
  repositoryId: "repo-1",
  branch: "feat-login",
  ...overrides,
});

const defaultProps = {
  agents: testAgents,
  sessions: [] as SessionInfo[],
  repositories: [] as RepositoryInfo[],
  worktrees: new Map<string, WorktreeInfo[]>(),
  cloningRepos: new Map<string, string>(),
  connectionStatus: "connected" as const,
  selectedSessionId: null,
  onSelectSession: vi.fn(),
  onCreateSession: vi.fn(async () => null),
  onDeleteSession: vi.fn(),
  onOpenProject: vi.fn(),
  onCloneFromUrl: vi.fn(),
  onCreateWorktree: vi.fn(),
  onDeleteWorktree: vi.fn(),
};

describe("Sidebar", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("shows empty state when no repositories or sessions", () => {
    render(<Sidebar {...defaultProps} />);
    expect(screen.getByText("No repositories")).toBeInTheDocument();
  });

  it("renders repository with name", () => {
    const repo = makeRepo();
    render(
      <Sidebar
        {...defaultProps}
        repositories={[repo]}
        worktrees={new Map([["repo-1", []]])}
      />,
    );
    expect(screen.getByTestId("repo-item-my-project")).toBeInTheDocument();
    expect(screen.getByText("my-project")).toBeInTheDocument();
  });

  it("renders worktree under repository", () => {
    const repo = makeRepo();
    const wt = makeWorktree();
    const session = makeSession();

    render(
      <Sidebar
        {...defaultProps}
        repositories={[repo]}
        worktrees={new Map([["repo-1", [wt]]])}
        sessions={[session]}
      />,
    );

    expect(screen.getByTestId("worktree-item-feat-login")).toBeInTheDocument();
    expect(screen.getByText("feat-login")).toBeInTheDocument();
  });

  it("selects session when clicking worktree with active session", () => {
    const onSelectSession = vi.fn();
    const repo = makeRepo();
    const wt = makeWorktree();
    const session = makeSession();

    render(
      <Sidebar
        {...defaultProps}
        repositories={[repo]}
        worktrees={new Map([["repo-1", [wt]]])}
        sessions={[session]}
        onSelectSession={onSelectSession}
      />,
    );

    fireEvent.click(screen.getByTestId("worktree-item-feat-login"));
    expect(onSelectSession).toHaveBeenCalledWith("sess-1");
  });

  it("shows connected status indicator", () => {
    render(<Sidebar {...defaultProps} connectionStatus="connected" />);
    expect(screen.getByTestId("connection-status-connected")).toBeInTheDocument();
  });

  it("shows no connected indicator when offline", () => {
    render(<Sidebar {...defaultProps} connectionStatus="offline" />);
    expect(screen.queryByTestId("connection-status-connected")).not.toBeInTheDocument();
  });

  it("renders legacy sessions without worktreeId", () => {
    const session = makeSession({ worktreeId: null, sessionId: "legacy-1" });
    render(<Sidebar {...defaultProps} sessions={[session]} />);
    // Legacy session should be rendered via SessionItem
    expect(screen.getByTestId("session-item-legacy-1")).toBeInTheDocument();
  });
});
