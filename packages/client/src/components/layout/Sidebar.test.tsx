import type { ReactNode } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SessionInfo, RepositoryInfo, WorktreeInfo } from "@matrix/protocol";
import { Sidebar } from "@/components/layout/Sidebar";
import type { ServerInfo } from "@/components/layout/Sidebar";

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
  createdAt: "2026-03-20T10:00:00.000Z",
  ...overrides,
});

const makeWorktree = (overrides?: Partial<WorktreeInfo>): WorktreeInfo => ({
  id: "wt-1",
  repositoryId: "repo-1",
  branch: "feat-login",
  baseBranch: "main",
  path: "/tmp/worktrees/feat-login",
  status: "active",
  taskDescription: null,
  createdAt: "2026-03-20T10:00:00.000Z",
  lastActiveAt: "2026-03-20T10:00:00.000Z",
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

function makeServer(overrides?: Partial<ServerInfo>): ServerInfo {
  return {
    serverId: "__sidecar__",
    name: "Local",
    status: "connected",
    error: null,
    sessions: [],
    repositories: [],
    worktrees: new Map<string, WorktreeInfo[]>(),
    agents: testAgents,
    cloningRepos: new Map<string, string>(),
    ...overrides,
  };
}

const defaultProps = {
  servers: [makeServer()],
  selectedSessionId: null,
  onSelectSession: vi.fn(),
  onCreateSession: vi.fn(async () => null),
  onDeleteSession: vi.fn(),
  onOpenProject: vi.fn(),
  onCloneFromUrl: vi.fn(),
  onCreateWorktree: vi.fn(),
  onDeleteWorktree: vi.fn(),
  onReconnect: vi.fn(),
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

  it("renders server section with data-testid", () => {
    render(<Sidebar {...defaultProps} />);
    expect(screen.getByTestId("server-section-__sidecar__")).toBeInTheDocument();
  });

  it("renders server status dot", () => {
    render(<Sidebar {...defaultProps} />);
    expect(screen.getByTestId("server-status-dot")).toBeInTheDocument();
  });

  it("renders repository with name", () => {
    const repo = makeRepo();
    const server = makeServer({
      repositories: [repo],
      worktrees: new Map([["repo-1", []]]),
    });
    render(<Sidebar {...defaultProps} servers={[server]} />);
    expect(screen.getByTestId("repo-item-my-project")).toBeInTheDocument();
    expect(screen.getByText("my-project")).toBeInTheDocument();
  });

  it("renders worktree under repository", () => {
    const repo = makeRepo();
    const wt = makeWorktree();
    const session = makeSession();
    const server = makeServer({
      repositories: [repo],
      worktrees: new Map([["repo-1", [wt]]]),
      sessions: [session],
    });

    render(<Sidebar {...defaultProps} servers={[server]} />);

    expect(screen.getByTestId("worktree-item-feat-login")).toBeInTheDocument();
    expect(screen.getByText("feat-login")).toBeInTheDocument();
  });

  it("selects session when clicking worktree with active session", () => {
    const onSelectSession = vi.fn();
    const repo = makeRepo();
    const wt = makeWorktree();
    const session = makeSession();
    const server = makeServer({
      repositories: [repo],
      worktrees: new Map([["repo-1", [wt]]]),
      sessions: [session],
    });

    render(
      <Sidebar
        {...defaultProps}
        servers={[server]}
        onSelectSession={onSelectSession}
      />,
    );

    fireEvent.click(screen.getByTestId("worktree-item-feat-login"));
    expect(onSelectSession).toHaveBeenCalledWith("sess-1", "__sidecar__");
  });

  it("shows connected status indicator", () => {
    render(<Sidebar {...defaultProps} />);
    expect(screen.getByTestId("connection-status-connected")).toBeInTheDocument();
  });

  it("shows no connected indicator when offline", () => {
    const server = makeServer({ status: "offline" });
    render(<Sidebar {...defaultProps} servers={[server]} />);
    expect(screen.queryByTestId("connection-status-connected")).not.toBeInTheDocument();
  });

  it("renders legacy sessions without worktreeId", () => {
    const session = makeSession({ worktreeId: null, sessionId: "legacy-1" });
    const server = makeServer({ sessions: [session] });
    render(<Sidebar {...defaultProps} servers={[server]} />);
    // Legacy session should be rendered via SessionItem
    expect(screen.getByTestId("session-item-legacy-1")).toBeInTheDocument();
  });

  it("renders multiple server sections", () => {
    const sidecar = makeServer({ serverId: "__sidecar__", name: "Local" });
    const remote = makeServer({ serverId: "remote-1", name: "Remote Dev", status: "connected" });
    render(<Sidebar {...defaultProps} servers={[sidecar, remote]} />);
    expect(screen.getByTestId("server-section-__sidecar__")).toBeInTheDocument();
    expect(screen.getByTestId("server-section-remote-1")).toBeInTheDocument();
  });
});
